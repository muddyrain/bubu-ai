import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_LIMITS } from '../../shared/chat';
import type { Conversation } from '../../shared/chat';
import { empty, recipient } from './test-helpers';
import { FileConversationStore } from './conversation-store';

const fs = vi.hoisted(()=>({ nodes:new Map<string,{raw:Buffer;mode:number;kind:'file'|'directory'|'link'}>(), failSync:false, failRename:false,
  opens:[] as {path:string;flags:string|number;mode:number|undefined}[] }));
vi.mock('node:fs/promises',()=>{
  const enoent=()=>Object.assign(new Error('mock missing'),{code:'ENOENT'});
  const stat=(path:string)=>{const n=fs.nodes.get(path);if(!n)throw enoent();return {size:n.raw.length,mode:n.mode,isFile:()=>n.kind==='file',isDirectory:()=>n.kind==='directory',isSymbolicLink:()=>n.kind==='link'};};
  return {
    lstat:vi.fn(async(path:string)=>stat(path)),
    mkdir:vi.fn(async(path:string,options:{mode:number})=>{if(!fs.nodes.has(path))fs.nodes.set(path,{kind:'directory',mode:options.mode,raw:Buffer.alloc(0)});}),
    readdir:vi.fn(async(root:string)=>[...fs.nodes.keys()].filter(p=>p.startsWith(root+'/')&&!p.slice(root.length+1).includes('/')).map(p=>p.slice(root.length+1))),
    unlink:vi.fn(async(path:string)=>{if(!fs.nodes.delete(path))throw enoent();}),
    rename:vi.fn(async(from:string,to:string)=>{if(fs.failRename)throw new Error('mock rename');const n=fs.nodes.get(from);if(!n)throw enoent();fs.nodes.set(to,n);fs.nodes.delete(from);}),
    open:vi.fn(async(path:string,flags:string|number,mode?:number)=>{
      fs.opens.push({path,flags,mode});let cursor=0;
      if(flags==='wx'){if(fs.nodes.has(path))throw new Error('mock exists');fs.nodes.set(path,{kind:'file',mode:mode!,raw:Buffer.alloc(0)});}
      const node=fs.nodes.get(path);if(!node)throw enoent();if(node.kind==='link')throw new Error('mock O_NOFOLLOW');
      return {stat:async()=>stat(path),close:vi.fn(async()=>{}),sync:vi.fn(async()=>{if(fs.failSync)throw new Error('mock fsync');}),
        writeFile:async(raw:string)=>{node.raw=Buffer.from(raw);},
        read:async(buffer:Buffer,offset:number,length:number)=>{const bytesRead=Math.min(length,node.raw.length-cursor);node.raw.copy(buffer,offset,cursor,cursor+bytesRead);cursor+=bytesRead;return {bytesRead};}};
    }),
  };
});
const root='/mock/chat/conversations', parent='/mock/chat';
const path=(c:Conversation)=>`${root}/${c.id}.json`;
function directories(){for(const p of [parent,root])fs.nodes.set(p,{kind:'directory',mode:0o700,raw:Buffer.alloc(0)});}
function place(c:Conversation){directories();fs.nodes.set(path(c),{kind:'file',mode:0o600,raw:Buffer.from(JSON.stringify(c))});}
function withPairs(count:number,bytes=10):Conversation {
  const c=empty(), r=recipient();c.lastRecipient=r;
  for(let i=0;i<count;i++){
    const common={requestId:randomUUID(),runId:randomUUID(),recipient:r,createdAt:c.createdAt,updatedAt:c.updatedAt};
    c.messages.push({...common,id:randomUUID(),role:'user',text:'hello',seq:0,status:'completed'},
      {...common,id:randomUUID(),role:'assistant',text:'x'.repeat(bytes),seq:3,status:'completed',finishReason:'stop'});
  }
  return c;
}
beforeEach(()=>{fs.nodes.clear();fs.opens=[];fs.failRename=false;fs.failSync=false;});
describe('versioned conversation JSON store with a mocked filesystem',()=>{
  it('starts absent, writes privately via fsync and atomic rename, then reads bounded JSON using O_NOFOLLOW',async()=>{
    const store=new FileConversationStore(root);expect(await store.load()).toEqual([]);const c=withPairs(1);await store.commit(c);
    expect([...fs.nodes.keys()].filter(p=>p.endsWith('.tmp'))).toEqual([]);expect(fs.nodes.get(path(c))?.mode).toBe(0o600);
    expect(fs.opens[0]).toMatchObject({flags:'wx',mode:0o600});expect(await new FileConversationStore(root).load()).toEqual([c]);
    expect(fs.opens.at(-1)?.flags).toBe(constants.O_RDONLY|constants.O_NOFOLLOW);
    await store.remove(c.id);expect(fs.nodes.has(path(c))).toBe(false);
  });
  it.each(['sync','rename'] as const)('preserves the old complete record and cleans its temporary file after failed %s',async(failure)=>{
    const c=withPairs(1);place(c);const store=new FileConversationStore(root);await store.load();const original=Buffer.from(fs.nodes.get(path(c))!.raw);
    if(failure==='sync')fs.failSync=true;else fs.failRename=true;
    await expect(store.commit({...c,title:'changed',revision:2})).rejects.toThrow('STORE_FAILED');
    expect(fs.nodes.get(path(c))!.raw).toEqual(original);expect([...fs.nodes.keys()].some(p=>p.endsWith('.tmp'))).toBe(false);
  });
  it.each(['directory-link','file-link','directory-mode','file-mode','invalid-json','unknown-field','oversize','invalid-id','wrong-path','invalid-base'] as const)('rejects %s without modifying existing records',async(kind)=>{
    const c=withPairs(1);place(c);const file=fs.nodes.get(path(c))!;
    if(kind==='directory-link')fs.nodes.get(parent)!.kind='link';if(kind==='file-link')file.kind='link';
    if(kind==='directory-mode')fs.nodes.get(root)!.mode=0o755;if(kind==='file-mode')file.mode=0o644;
    if(kind==='invalid-json')file.raw=Buffer.from('private broken JSON');if(kind==='unknown-field')file.raw=Buffer.from(JSON.stringify({...c,apiKey:'mock-not-real'}));
    if(kind==='oversize')file.raw=Buffer.alloc(CHAT_LIMITS.conversationBytes+1);
    if(kind==='invalid-id')fs.nodes.set(`${root}/bad.json`,file);
    if(kind==='wrong-path')file.raw=Buffer.from(JSON.stringify({...c,id:randomUUID()}));
    if(kind==='invalid-base')file.raw=Buffer.from(JSON.stringify({...c,lastRecipient:{...c.lastRecipient,baseUrl:'invalid'}}));
    const before=fs.nodes.size;await expect(new FileConversationStore(root).load()).rejects.toThrow('STORE_CORRUPT');expect(fs.nodes.size).toBe(before);
  });
  it('ignores bounded incomplete atomic files but rejects duplicate request IDs across conversations',async()=>{
    const c=withPairs(1);place(c);fs.nodes.set(`${path(c)}.${randomUUID()}.tmp`,{kind:'file',mode:0o600,raw:Buffer.from('partial')});
    expect(await new FileConversationStore(root).load()).toEqual([c]);
    const duplicate={...c,id:randomUUID()};place(duplicate);await expect(new FileConversationStore(root).load()).rejects.toThrow('STORE_CORRUPT');
  });
  it('caps conversation count, per-file bytes, message count and total disk bytes',async()=>{
    const store=new FileConversationStore(root);await store.load();
    await expect(store.commit(withPairs(101))).rejects.toThrow('STORE_FAILED');
    await expect(store.commit(withPairs(16,65_536))).rejects.toThrow('LIMIT_REACHED');
    for(let i=0;i<100;i++)await store.commit(empty());await expect(store.commit(empty())).rejects.toThrow('LIMIT_REACHED');
    fs.nodes.clear();const total=new FileConversationStore(root);await total.load();
    for(let i=0;i<21;i++)await total.commit(withPairs(15,65_536));
    await expect(total.commit(withPairs(15,65_536))).rejects.toThrow('LIMIT_REACHED');
  });
  it('refuses writes or deletes through a replaced target symlink',async()=>{
    const c=empty();place(c);const store=new FileConversationStore(root);await store.load();fs.nodes.get(path(c))!.kind='link';
    await expect(store.commit({...c,revision:2})).rejects.toThrow('STORE_FAILED');await expect(store.remove(c.id)).rejects.toThrow('STORE_FAILED');
  });
});
