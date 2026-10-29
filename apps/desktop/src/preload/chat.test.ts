import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CHAT_CHANNELS, CHAT_EVENT_CHANNEL } from '../shared/chat';
import type { ChatEvent, ChatUpdate } from '../shared/chat';
import { deferred, recipient, snapshot } from '../main/chat/test-helpers';
import { createChatBridge } from './chat';
function fixture() {
  const initial = snapshot(), subscriptionId=randomUUID(), requestId=randomUUID(), runId=randomUUID(), now=new Date().toISOString();
  const base = {sessionId:initial.sessionId,subscriptionId,requestId,runId,conversationId:initial.conversation.id,revision:2};
  const message = {id:randomUUID(),requestId,runId,role:'assistant' as const,text:'',status:'pending' as const,seq:1,recipient:recipient(),createdAt:now,updatedAt:now};
  const first:ChatEvent={...base,type:'started',seq:1,title:'hello',user:{...message,id:randomUUID(),role:'user',text:'hello',status:'completed',seq:0},message};
  const delta:ChatEvent={...base,type:'delta',seq:2,text:'你好😀'};
  const listeners=new Set<(event:unknown,value:unknown)=>void>(), ack=deferred<unknown>();
  const ipc={invoke:vi.fn<(channel:string,...args:unknown[])=>Promise<unknown>>(async(channel)=>channel===CHAT_CHANNELS.subscribe?ack.promise:{ok:true,value:undefined}),
    on:vi.fn((_channel:string,listener:(e:unknown,v:unknown)=>void)=>listeners.add(listener)),
    removeListener:vi.fn((_channel:string,listener:(e:unknown,v:unknown)=>void)=>listeners.delete(listener))};
  const api=createChatBridge(ipc), updates:ChatUpdate[]=[], input={conversationId:initial.conversation.id};
  return {api,ipc,initial,subscriptionId,first,delta,updates,input,ack,listeners,
    emit:(value:unknown)=>{for(const listener of listeners)listener({privateRawEvent:true},value);},
    ready:()=>ack.resolve({ok:true,value:{subscriptionId,snapshot:initial}})};
}
describe('chat Preload handshake and safe event delivery',()=>{
  it('installs the listener before subscribe, buffers the first events and returns their watermark',async()=>{
    const f=fixture(), subscribing=f.api.subscribe(f.input,(e)=>f.updates.push(e));
    expect(f.ipc.on.mock.invocationCallOrder[0]).toBeLessThan(f.ipc.invoke.mock.invocationCallOrder[0]!);
    f.emit(f.first); f.emit(f.delta); f.ready(); const result=await subscribing;
    expect(result).toMatchObject({ok:true,value:{snapshot:{watermark:{seq:2},conversation:{messages:[{text:'hello'},{text:'你好😀'}]}}}});
    expect(f.updates).toEqual([f.first,f.delta]); f.emit(f.delta); expect(f.updates).toHaveLength(2);
    expect(JSON.stringify(f.updates)).not.toContain('privateRawEvent');
    await f.api.unsubscribe({subscriptionId:f.subscriptionId}); expect(f.listeners.size).toBe(0);
    expect(f.ipc.invoke.mock.calls.filter(([c])=>c===CHAT_CHANNELS.unsubscribe)).toHaveLength(1);
  });
  it('does not deliver events from another subscription, session, conversation or invalid envelope',async()=>{
    const f=fixture(), subscribing=f.api.subscribe(f.input,(e)=>f.updates.push(e));f.ready();await subscribing;
    for(const patch of [{subscriptionId:randomUUID()},{sessionId:randomUUID()},{conversationId:randomUUID()},{secret:'no'},{message:{...f.first.message,apiKey:'no'}}])f.emit({...f.first,...patch});
    expect(f.updates).toEqual([]); await f.api.unsubscribe({subscriptionId:f.subscriptionId});
  });
  it('replaces consumer state explicitly after an event gap instead of silently discarding text',async()=>{
    const f=fixture(), subscribing=f.api.subscribe(f.input,(e)=>f.updates.push(e));f.ready();await subscribing;
    const authoritative=structuredClone(f.initial); authoritative.conversation.messages=[f.first.user,f.first.message];
    authoritative.conversation.messages[1]!.text='recovered';authoritative.conversation.messages[1]!.seq=3; authoritative.watermark={runId:f.first.runId,seq:3};
    f.ipc.invoke.mockResolvedValueOnce({ok:true,value:authoritative});f.emit({...f.delta,seq:3});
    await vi.waitFor(()=>expect(f.updates).toEqual([{type:'resync',subscriptionId:f.subscriptionId,snapshot:authoritative}]));
    f.emit({...f.delta,seq:4});expect(f.updates.at(-1)).toMatchObject({type:'delta',seq:4});await f.api.unsubscribe({subscriptionId:f.subscriptionId});
  });
  it('recovers a bounded early-event overflow from a snapshot, without replaying send',async()=>{
    const f=fixture(), subscribing=f.api.subscribe(f.input,(e)=>f.updates.push(e));
    for(let i=0;i<140;i++)f.emit({...f.delta,seq:i+2});
    f.ipc.invoke.mockResolvedValueOnce({ok:true,value:f.initial});f.ready();expect((await subscribing).ok).toBe(true);
    expect(f.updates.some(e=>e.type==='resync')).toBe(true);expect(f.ipc.invoke.mock.calls.some(([c])=>c===CHAT_CHANNELS.send)).toBe(false);
    await f.api.unsubscribe({subscriptionId:f.subscriptionId});
  });
  it('closes a superseded in-flight subscription and cleans up its late acknowledgement',async()=>{
    const f=fixture(), first=f.api.subscribe(f.input,()=>{}), secondAck=deferred<unknown>();
    f.ipc.invoke.mockImplementationOnce(()=>secondAck.promise);const second=f.api.subscribe(f.input,()=>{});
    f.ready();expect(await first).toMatchObject({ok:false,error:{code:'CANCELLED'}});
    secondAck.resolve({ok:true,value:{subscriptionId:randomUUID(),snapshot:f.initial}});const result=await second;
    expect(f.listeners.size).toBe(1);if(result.ok)await f.api.unsubscribe({subscriptionId:result.value.subscriptionId});
  });
  it('cleans up on a failed handshake, rejected recovery or a throwing consumer',async()=>{
    const f=fixture(), failed=f.api.subscribe(f.input,()=>{});f.ack.resolve({ok:false,error:{code:'NOT_FOUND'}});
    expect(await failed).toMatchObject({ok:false});expect(f.listeners.size).toBe(0);
    const g=fixture(), ready=g.api.subscribe(g.input,()=>{});g.ready();await ready;
    g.ipc.invoke.mockRejectedValueOnce(new Error('private'));g.emit(g.delta);await vi.waitFor(()=>expect(g.listeners.size).toBe(0));
    const h=fixture(), throwing=h.api.subscribe(h.input,()=>{throw new Error('consumer');});h.ready();await throwing;h.emit(h.first);expect(h.listeners.size).toBe(0);
  });
  it('uses only fixed named channels and forwards no extra user arguments',async()=>{
    const f=fixture();expect(Object.isFrozen(f.api)).toBe(true);
    const list=f.api.list as (...args:unknown[])=>Promise<unknown>;await list('fs:read');expect(f.ipc.invoke).toHaveBeenCalledWith(CHAT_CHANNELS.list);
    expect(f.ipc.on).not.toHaveBeenCalled();expect(Object.keys(f.api).sort()).toEqual(Object.keys(CHAT_CHANNELS).sort());expect(CHAT_EVENT_CHANNEL).toBe('bubu:chat:event');
  });
});
