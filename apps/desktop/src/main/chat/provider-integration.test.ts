import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../shared/chat';
import type { SaveProviderInput } from '../../shared/providers';
import { CredentialVault } from '../providers/credential-vault';
import { ProviderService } from '../providers/provider-service';
import { MemoryStorage, mockSafeStorage } from '../providers/test-helpers';
import { ChatService } from './chat-service';
import { checkSignal } from './errors';
import { OpenAIChatStreamAdapter } from './openai-chat-stream';
import { deferred, MemoryConversationStorage } from './test-helpers';
const input=():SaveProviderInput=>({name:'Mock',protocol:'openai-compatible-chat-completions',baseUrl:'https://provider.example/v1',modelId:'mock',enabled:true,key:{action:'replace',value:'fixture-only-key'}});
async function fixture(){
  const storage=new MemoryStorage(),backend=mockSafeStorage(), probe={probe:vi.fn(async()=>'passed' as const)};
  const providers=new ProviderService(storage,new CredentialVault(backend,'darwin'),probe);
  const profile=(await providers.save(input())).profiles[0]!;
  await providers.probe({}, {id:profile.id,revision:1,requestId:randomUUID(),consent:{origin:'https://provider.example',accepted:true}},'connection');
  await providers.select({id:profile.id,expectedRevision:1});
  const network=deferred<void>(),requested=deferred<void>();let bytes!:(b:Buffer)=>void,signal!:AbortSignal;
  const transport={stream:vi.fn(async(_url:string,key:string,_body:object,s:AbortSignal,onBytes:(b:Buffer)=>void)=>{
    expect(key).toBe('fixture-only-key');bytes=onBytes;signal=s;requested.resolve();
    await new Promise<void>((resolve,reject)=>{network.promise.then(resolve,reject);s.addEventListener('abort',()=>{try{checkSignal(s);}catch(error){reject(error);}},{once:true});});
  })};
  const conversations=new MemoryConversationStorage(),service=new ChatService(conversations,providers,new OpenAIChatStreamAdapter(transport));
  const c=await service.create(),owner={},events:ChatEvent[]=[],terminal=deferred<ChatEvent>();
  const sub=await service.subscribe(owner,c.conversation.id,(e)=>{events.push(e);if(['completed','failed','stopped'].includes(e.type))terminal.resolve(e);});
  const prepare=()=>service.prepareSend(owner,{conversationId:c.conversation.id,expectedRevision:conversations.data.get(c.conversation.id)!.revision,requestId:randomUUID(),text:'hello'});
  return {providers,profile,storage,backend,probe,service,conversations,c,owner,sub,events,terminal,prepare,transport,network,requested,
    bytes:(text:string)=>bytes(Buffer.from(text)),signal:()=>signal};
}
describe('Chat + reviewed ProviderService + vault + SSE adapter integration (all external boundaries Mock)',()=>{
  it.each(['edit','delete','disable','select'] as const)('aborts an in-flight SSE stream on provider %s with one truthful terminal and no retries',async(action)=>{
    const f=await fixture(),plan=await f.prepare();await f.service.send(f.owner,{planId:plan.id,subscriptionId:f.sub.subscriptionId});await f.requested.promise;
    f.bytes('data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n');
    const target={id:f.profile.id,expectedRevision:1};
    if(action==='delete')await f.providers.remove(target);else if(action==='select')await f.providers.select(target);
    else await f.providers.save({...input(),...target,enabled:action!=='disable',key:{action:'keep'}});
    expect(f.signal().aborted).toBe(true);expect(await f.terminal.promise).toMatchObject({type:'failed',message:{text:'partial',errorCode:'PROVIDER_CHANGED'}});
    expect(()=>f.bytes('data: [DONE]\n\n')).toThrow('PROVIDER_CHANGED');expect(f.transport.stream).toHaveBeenCalledOnce();expect(f.probe.probe).toHaveBeenCalledOnce();
    expect(JSON.stringify([...f.conversations.data.values()])).not.toContain('fixture-only-key');f.service.dispose();
  });
  it('rejects a plan after provider revision/selection changes, without writing messages or opening a stream',async()=>{
    const f=await fixture(),plan=await f.prepare();await f.providers.save({...input(),id:f.profile.id,expectedRevision:1,key:{action:'keep'}});
    await expect(f.service.send(f.owner,{planId:plan.id,subscriptionId:f.sub.subscriptionId})).rejects.toThrow('PROVIDER_CHANGED');
    expect(f.transport.stream).not.toHaveBeenCalled();expect(f.conversations.data.get(f.c.conversation.id)?.messages).toEqual([]);f.service.dispose();
  });
  it('protects exact conversation revisions from another owner consuming a prepared stale plan',async()=>{
    const f=await fixture(),plan=await f.prepare(),other={};
    const sub=await f.service.subscribe(other,f.c.conversation.id,()=>{});
    const otherPlan=await f.service.prepareSend(other,{conversationId:f.c.conversation.id,expectedRevision:1,requestId:randomUUID(),text:'other owner'});
    await f.service.send(f.owner,{planId:plan.id,subscriptionId:f.sub.subscriptionId});await f.requested.promise;
    f.bytes('data: {"choices":[{"index":0,"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');f.network.resolve();await f.terminal.promise;
    await expect(f.service.send(other,{planId:otherPlan.id,subscriptionId:sub.subscriptionId})).rejects.toThrow('CONFLICT');expect(f.transport.stream).toHaveBeenCalledOnce();f.service.dispose();
  });
});
