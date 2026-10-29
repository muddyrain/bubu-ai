// @vitest-environment jsdom
import { act,cleanup,renderHook,waitFor } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import type { ChatEvent,ChatResult,SubscriptionReady } from '../../../shared/chat';
import { useChat } from './useChat';
import { chatMock } from './test-helpers';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
async function mount(){
  const mock=chatMock();await mock.api.create();vi.stubGlobal('bubu',{chat:mock.api});
  const hook=renderHook(({enabled})=>useChat(enabled),{initialProps:{enabled:true}});await waitFor(()=>expect(hook.result.current.loading).toBe(false));
  return{mock,...hook};
}
describe('useChat subscription and request fencing',()=>{
  it('immediately clears a cancelled preparation when its already-created plan arrives late, without a polling tick',async()=>{
    const f=await mount(),original=f.mock.api.prepareSend.getMockImplementation()!,entered=deferred<void>(),ack=deferred<Awaited<ReturnType<typeof original>>>();
    let prepared!:Awaited<ReturnType<typeof original>>;
    f.mock.api.prepareSend.mockImplementationOnce(async input=>{prepared=await original(input);entered.resolve();return ack.promise;});
    vi.useFakeTimers();
    try{
      act(()=>f.result.current.setDraft('取消后保留草稿'));let sending!:Promise<void>;
      await act(async()=>{sending=f.result.current.send();await entered.promise;});expect(f.result.current.phase).toBe('preparing');
      await act(async()=>{await f.result.current.cancel();});const reads=f.mock.api.snapshot.mock.calls.length;
      await act(async()=>{ack.resolve(prepared);await sending;});
      expect(f.result.current.busy).toBe(false);expect(f.result.current.phase).toBeUndefined();expect(f.result.current.plan).toBeUndefined();expect(f.result.current.draft).toBe('取消后保留草稿');
      expect(f.mock.api.send).not.toHaveBeenCalled();expect(f.mock.api.snapshot).toHaveBeenCalledTimes(reads);expect(f.mock.api.subscribe).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }finally{vi.useRealTimers();}
  });
  it('does not resubscribe for drafts or plain rerenders; disables and restores the same session explicitly',async()=>{
    const f=await mount();act(()=>f.result.current.setDraft('draft'));f.rerender({enabled:true});expect(f.mock.api.subscribe).toHaveBeenCalledOnce();
    f.rerender({enabled:false});expect(f.mock.api.unsubscribe).toHaveBeenCalledOnce();f.rerender({enabled:true});
    await waitFor(()=>expect(f.mock.api.subscribe).toHaveBeenCalledTimes(2));expect(f.result.current.draft).toBe('draft');
  });
  it('buffers early subscribe events against the returned watermark and never sends automatically',async()=>{
    const mock=chatMock();const created=await mock.api.create();if(!created.ok)throw Error();
    const events:ChatEvent[]=[];const ready=await mock.api.subscribe({conversationId:created.value.conversation.id},e=>{if(e.type!=='resync')events.push(e);});if(!ready.ok)throw Error();
    const plan=await mock.api.prepareSend({conversationId:created.value.conversation.id,expectedRevision:1,requestId:crypto.randomUUID(),text:'hello'});if(!plan.ok)throw Error();
    await mock.api.send({planId:plan.value.id,subscriptionId:ready.value.subscriptionId});mock.text('first delta');mock.api.send.mockClear();mock.api.prepareSend.mockClear();
    mock.api.subscribe.mockImplementationOnce(async(_input,cb)=>{events.forEach(cb);return ready;});
    vi.stubGlobal('bubu',{chat:mock.api});const h=renderHook(()=>useChat(true));
    await waitFor(()=>expect(h.result.current.snapshot?.conversation.messages.at(-1)?.text).toBe('first delta'));
    expect(mock.api.send).not.toHaveBeenCalled();expect(mock.api.prepareSend).not.toHaveBeenCalled();
  });
  it('cleans up an in-flight subscription acknowledgement after unmount',async()=>{
    const mock=chatMock();const created=await mock.api.create();if(!created.ok)throw Error();
    const ack=deferred<ChatResult<SubscriptionReady>>();mock.api.subscribe.mockImplementationOnce(()=>ack.promise);
    vi.stubGlobal('bubu',{chat:mock.api});const h=renderHook(()=>useChat(true));await waitFor(()=>expect(mock.api.subscribe).toHaveBeenCalledOnce());h.unmount();
    const subscriptionId=crypto.randomUUID();await act(async()=>ack.resolve({ok:true,value:{subscriptionId,snapshot:created.value}}));
    expect(mock.api.unsubscribe).toHaveBeenCalledWith({subscriptionId});
  });
  it('cancels a plan received after unmount rather than dispatching a paid request',async()=>{
    const f=await mount(),prepared=f.mock.api.prepareSend.getMockImplementation()!,ack=deferred<Awaited<ReturnType<typeof prepared>>>();
    let input!:Parameters<typeof prepared>[0];f.mock.api.prepareSend.mockImplementationOnce(async arg=>{input=arg;return ack.promise;});
    act(()=>f.result.current.setDraft('queued'));let sending!:Promise<void>;act(()=>{sending=f.result.current.send();});await waitFor(()=>expect(f.mock.api.prepareSend).toHaveBeenCalledOnce());
    f.unmount();const result=await prepared(input);await act(async()=>{ack.resolve(result);await sending;});
    expect(f.mock.api.send).not.toHaveBeenCalled();expect(f.mock.api.cancel).toHaveBeenCalledWith({requestId:input.requestId});
  });
  it('keeps a newer request running if an older send receipt fails after its terminal',async()=>{
    const f=await mount(),original=f.mock.api.send.getMockImplementation()!,ack=deferred<ChatResult<{requestId:string;runId:string}>>();
    f.mock.api.send.mockImplementationOnce(async input=>{await original(input);return ack.promise;});
    act(()=>f.result.current.setDraft('one'));let first!:Promise<void>;act(()=>{first=f.result.current.send();});await waitFor(()=>expect(f.mock.api.send).toHaveBeenCalledOnce());
    await act(async()=>{f.mock.text('answer');f.mock.end();});act(()=>f.result.current.setDraft('two'));await act(async()=>f.result.current.send());
    expect(f.result.current.busy).toBe(true);await act(async()=>{ack.resolve({ok:false,error:{code:'NETWORK_FAILED'}});await first;});
    expect(f.result.current.busy).toBe(true);expect(f.result.current.error).toBeUndefined();await act(async()=>f.mock.end('stopped'));
  });
  it('surfaces a rejected handshake without sending, and supports explicit reopening',async()=>{
    const mock=chatMock();await mock.api.create();mock.api.subscribe.mockRejectedValueOnce(new Error('private detail'));
    vi.stubGlobal('bubu',{chat:mock.api});const h=renderHook(()=>useChat(true));await waitFor(()=>expect(h.result.current.error).toBe('NETWORK_FAILED'));
    expect(h.result.current.loading).toBe(false);expect(mock.api.send).not.toHaveBeenCalled();
    const id=[...mock.data.keys()][0]!;await act(async()=>{await h.result.current.open(id);});expect(mock.api.subscribe).toHaveBeenCalledTimes(2);expect(h.result.current.snapshot?.conversation.id).toBe(id);
  });
});
