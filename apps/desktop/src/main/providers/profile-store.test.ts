import { constants } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileProfileStorage, emptyStore } from './profile-store';

const disk=vi.hoisted(()=>({ files:new Map<string,Buffer>(), fail:'', symlink:false, readFlags:[] as number[], operations:[] as string[] }));
vi.mock('node:fs/promises',()=>({
  mkdir:vi.fn(async()=>{}),
  lstat:vi.fn(async()=>({isDirectory:()=>true,isSymbolicLink:()=>disk.symlink})),
  open:vi.fn(async(path:string,flags:string|number,mode?:number)=>{
    disk.operations.push(`open:${flags}:${mode??''}`);
    if(flags==='wx') {
      if(disk.files.has(path)) throw Object.assign(new Error(),{code:'EEXIST'});
      disk.files.set(path,Buffer.alloc(0));
    } else {
      disk.readFlags.push(Number(flags));
      if(!disk.files.has(path)) throw Object.assign(new Error(),{code:'ENOENT'});
    }
    let position=0;
    return {
      stat:async()=>({isFile:()=>true,size:disk.files.get(path)!.length}),
      read:async(buffer:Buffer,offset:number,length:number)=>{
        const bytes=disk.files.get(path)!.copy(buffer,offset,position,position+length);position+=bytes;return {bytesRead:bytes};
      },
      writeFile:async(data:string|Buffer)=>{ if(disk.fail==='write') throw new Error('private write'); disk.files.set(path,Buffer.from(data)); },
      sync:async()=>{ disk.operations.push('sync'); if(disk.fail==='sync')throw new Error('private sync'); },
      close:async()=>{disk.operations.push('close');},
    };
  }),
  rename:vi.fn(async(from:string,to:string)=>{
    disk.operations.push('rename');if(disk.fail==='rename')throw new Error('private rename');
    disk.files.set(to,disk.files.get(from)!);disk.files.delete(from);
  }),
  unlink:vi.fn(async(path:string)=>{disk.files.delete(path);}),
  readdir:vi.fn(async(directory:string)=>[...disk.files.keys()].filter(p=>p.startsWith(directory+'/')).map(p=>p.slice(directory.length+1))),
}));
beforeEach(()=>{disk.files.clear();disk.operations=[];disk.readFlags=[];disk.fail='';disk.symlink=false;});
describe('FileProfileStorage using an entirely mocked filesystem',()=>{
  it('uses atomic, exclusive private writes and restores validated metadata',async()=>{
    const store=new FileProfileStorage('/fixture/providers');
    await store.commit(emptyStore());expect(await store.load()).toEqual(emptyStore());
    expect(disk.operations[0]).toBe('open:wx:384');
    expect(disk.operations.indexOf('sync')).toBeLessThan(disk.operations.indexOf('rename'));
    expect(disk.readFlags[0]! & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
    expect([...disk.files.keys()]).toEqual(['/fixture/providers/profiles.json']);
  });
  it.each(['write','sync','rename'])('keeps the prior metadata after %s failure and removes temporary files',async(stage)=>{
    const store=new FileProfileStorage('/fixture/providers');await store.commit(emptyStore());
    const prior=Buffer.from(disk.files.get('/fixture/providers/profiles.json')!);disk.fail=stage;
    await expect(store.commit(emptyStore())).rejects.toThrow();
    expect(disk.files.get('/fixture/providers/profiles.json')).toEqual(prior);
    expect([...disk.files.keys()].some(p=>p.endsWith('.tmp'))).toBe(false);
  });
  it.each(['{broken','{"schemaVersion":99}','{"schemaVersion":1,"selectedProfileId":null,"profiles":[],"apiKey":"fixture-only-key"}'])('refuses corruption, unknown versions and secret-bearing unexpected fields',async(text)=>{
    disk.files.set('/fixture/providers/profiles.json',Buffer.from(text));
    await expect(new FileProfileStorage('/fixture/providers').load()).rejects.toThrow('STORE_CORRUPT');
    expect(disk.files.get('/fixture/providers/profiles.json')?.toString()).toBe(text);
  });
  it('rejects symlink directories, oversized files and unsafe credential references',async()=>{
    const store=new FileProfileStorage('/fixture/providers');disk.symlink=true;
    await expect(store.load()).rejects.toThrow('STORE_CORRUPT');
    disk.symlink=false;disk.files.set('/fixture/providers/profiles.json',Buffer.alloc(1048577));
    await expect(store.load()).rejects.toThrow('STORE_CORRUPT');
    await expect(store.readCredential('../../other')).rejects.toThrow('CREDENTIAL_UNAVAILABLE');
  });
});
