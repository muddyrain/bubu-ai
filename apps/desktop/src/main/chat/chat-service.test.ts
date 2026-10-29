import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyChatEvent, CHAT_LIMITS } from '../../shared/chat';
import type { ChatEvent } from '../../shared/chat';
import { ChatService } from './chat-service';
import { ChatError } from './errors';
import { deferred, MemoryConversationStorage, setupChat,recipient } from './test-helpers';

afterEach(() => vi.useRealTimers());
async function start(c: Awaited<ReturnType<typeof setupChat>>, text = '你好') {
  const plan = await c.prepare(text);
  const accepted = await c.service.send(c.owner, { planId: plan.id, subscriptionId: c.sub.subscriptionId, ...(plan.requiresConsent ? { accepted: true } : {}) });
  await c.requested.promise; return { plan, accepted };
}
describe('ChatService durable admission, ownership and consent', () => {
  it('cleans a failed preparation without writing messages or keeping an active intent', async () => {
    const c=await setupChat();vi.mocked(c.providers.selectedChatProfile).mockRejectedValueOnce(new ChatError('NOT_READY'));
    await expect(c.prepare()).rejects.toThrow('NOT_READY');
    expect(c.storage.commit).toHaveBeenCalledOnce();expect(c.adapter.stream).not.toHaveBeenCalled();
    expect((await c.prepare()).conversationId).toBe(c.c.conversation.id);c.service.dispose();
  });
  it.each(['context','messages'] as const)('rejects the %s quota before admission or network', async (kind) => {
    const c=await setupChat();await start(c);c.deliver('answer');c.network.resolve('stop');await c.terminal.promise;
    const data=structuredClone(c.storage.data.get(c.c.conversation.id)!);const [u,a]=data.messages;
    data.messages=[];
    for(let i=0;i<(kind==='context'?2:100);i++){
      const requestId=randomUUID(),runId=randomUUID();data.messages.push({...u!,id:randomUUID(),requestId,runId},
        {...a!,id:randomUUID(),requestId,runId,text:kind==='context'?'x'.repeat(65_536):'ok'});
    }
    c.storage.data.set(data.id,data);c.service.dispose();const service=new ChatService(c.storage,c.providers,c.adapter),owner={};
    await service.subscribe(owner,data.id,()=>{});
    await expect(service.prepareSend(owner,{conversationId:data.id,expectedRevision:data.revision,requestId:randomUUID(),text:'next'})).rejects.toThrow('LIMIT_REACHED');
    expect(c.adapter.stream).toHaveBeenCalledOnce();service.dispose();
  });
  it('globally reserves a request ID before queued preparation across different owners and conversations', async () => {
    const c=await setupChat(), other={}, next=await c.service.create();await c.service.subscribe(other,next.conversation.id,()=>{});
    const requestId=randomUUID(), input={conversationId:c.c.conversation.id,expectedRevision:1,requestId,text:'first'};
    const preparing=c.service.prepareSend(c.owner,input);
    await expect(c.service.prepareSend(other,{...input,conversationId:next.conversation.id})).rejects.toThrow('REPLAY');
    await preparing;c.service.cancel(c.owner,requestId);
    await expect(c.service.prepareSend(other,{...input,conversationId:next.conversation.id})).rejects.toThrow('REPLAY');
    expect(c.adapter.stream).not.toHaveBeenCalled();c.service.dispose();
  });
  it('prepares without writes, requires a prior subscription and persists both messages before exactly one network request', async () => {
    const c = await setupChat(), before = c.storage.commit.mock.calls.length;
    await expect(c.service.prepareSend({}, { conversationId: c.c.conversation.id, expectedRevision: 1, text: 'hello', requestId: randomUUID() })).rejects.toThrow('SUBSCRIPTION_REQUIRED');
    const plan = await c.prepare();
    expect(c.storage.commit).toHaveBeenCalledTimes(before); expect(c.adapter.stream).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).not.toContain('mock-only-secret');
    const accepted = c.service.send(c.owner, { planId: plan.id, subscriptionId: c.sub.subscriptionId });
    await c.requested.promise;
    const persisted = c.storage.data.get(c.c.conversation.id)!;
    expect(persisted.messages.map((m) => [m.role,m.status])).toEqual([['user','completed'],['assistant','pending']]);
    expect(c.events[0]?.type).toBe('started'); await accepted;
    await expect(c.service.send(c.owner, { planId: plan.id, subscriptionId: c.sub.subscriptionId })).rejects.toThrow('REPLAY');
    c.deliver('你好😀'); c.network.resolve('stop'); await c.terminal.promise;
    expect(c.adapter.stream).toHaveBeenCalledOnce(); expect(c.storage.data.get(persisted.id)?.messages.at(-1)).toMatchObject({ text: '你好😀', status: 'completed', finishReason: 'stop' });
    let reduced = c.sub.snapshot;
    for (const event of c.events) { const r = applyChatEvent(reduced,event); expect(r.state).toBe('applied'); reduced = r.snapshot; }
    expect(reduced.conversation.messages).toEqual(c.storage.data.get(persisted.id)?.messages);
    expect(reduced.conversation).toEqual(c.storage.data.get(persisted.id));
    expect(JSON.stringify(persisted)).not.toContain('mock-only-secret'); c.service.dispose();
  });
  it('rejects another owner, stale plans and global overlap without extra requests', async () => {
    const c = await setupChat(), plan = await c.prepare();
    await expect(c.service.send({}, { planId: plan.id, subscriptionId: c.sub.subscriptionId })).rejects.toThrow('PLAN_EXPIRED');
    await c.service.send(c.owner, { planId: plan.id, subscriptionId: c.sub.subscriptionId }); await c.requested.promise;
    expect(c.service.cancel({}, plan.requestId)).toEqual({ status:'not-running' });
    await expect(c.prepare('second')).rejects.toThrow('BUSY');
    c.service.cancel(c.owner,plan.requestId); await c.terminal.promise;
    expect(c.adapter.stream).toHaveBeenCalledOnce(); c.service.dispose();
  });
  it('rejects duplicate request IDs even after changing owner; a consumed plan never retries a failed admission', async () => {
    const c = await setupChat(); const { plan } = await start(c); c.deliver('ok'); c.network.resolve('stop'); await c.terminal.promise;
    const owner = {}; await c.service.subscribe(owner,c.c.conversation.id,() => {});
    await expect(c.service.prepareSend(owner,{ conversationId:c.c.conversation.id, expectedRevision:3, requestId:plan.requestId, text:'again' })).rejects.toThrow('REPLAY');
    expect(c.adapter.stream).toHaveBeenCalledOnce(); c.service.dispose();
  });
  it('expires plans without messages or a network call', async () => {
    vi.useFakeTimers(); const c = await setupChat(), plan = await c.prepare();
    await vi.advanceTimersByTimeAsync(CHAT_LIMITS.planMs);
    await expect(c.service.send(c.owner,{ planId:plan.id,subscriptionId:c.sub.subscriptionId })).rejects.toThrow('PLAN_EXPIRED');
    expect(c.storage.data.get(c.c.conversation.id)?.messages).toEqual([]); expect(c.adapter.stream).not.toHaveBeenCalled(); c.service.dispose();
  });
  it('requires exact-plan confirmation for history sent to a different profile, even at the same origin', async () => {
    const c = await setupChat(); await start(c); c.deliver('answer'); c.network.resolve('stop'); await c.terminal.promise;
    c.selected.id = randomUUID(); c.selected.name = 'Different recipient';
    const plan = await c.prepare('next'); expect(plan.requiresConsent).toBe(true); expect(plan.disclosure).toMatchObject({ userMessages:2,assistantMessages:1,currentInputIncluded:true });
    await expect(c.service.send(c.owner,{planId:plan.id,subscriptionId:c.sub.subscriptionId})).rejects.toThrow('CONSENT_REQUIRED');
    expect(c.adapter.stream).toHaveBeenCalledOnce();
    await c.service.send(c.owner,{planId:plan.id,subscriptionId:c.sub.subscriptionId,accepted:true});
    await vi.waitFor(() => expect(c.adapter.stream).toHaveBeenCalledTimes(2)); c.service.dispose();
  });
  it('does not send stopped or failed partial pairs in later context', async () => {
    const c = await setupChat(); const { plan } = await start(c); c.deliver('private partial');
    c.service.cancel(c.owner,plan.requestId); await c.terminal.promise;
    const next = await c.prepare('fresh'); expect(next.disclosure).toMatchObject({ userMessages:1,assistantMessages:0 });
    await c.service.send(c.owner,{planId:next.id,subscriptionId:c.sub.subscriptionId});
    await vi.waitFor(() => expect(c.adapter.stream).toHaveBeenCalledTimes(2));
    expect(vi.mocked(c.adapter.stream).mock.calls[1]?.[2]).toEqual([{role:'user',content:'fresh'}]); c.service.dispose();
  });
  it('rejects persisted input containing the current credential and enforces input limits', async () => {
    const c = await setupChat(); await expect(c.prepare('中'.repeat(6000))).rejects.toThrow('INVALID_INPUT');
    const plan = await c.prepare('mock-only-secret');
    await expect(c.service.send(c.owner,{planId:plan.id,subscriptionId:c.sub.subscriptionId})).rejects.toThrow('INVALID_INPUT');
    expect(c.adapter.stream).not.toHaveBeenCalled(); expect(c.storage.data.get(c.c.conversation.id)?.messages).toEqual([]); c.service.dispose();
  });
});
describe('deterministic cancellation and persistence races', () => {
  it.each(['file-checkpoint','file-final','total-checkpoint','total-final'])('preserves LIMIT_REACHED across a deferred real-byte quota boundary: %s',async(kind)=>{
    const c=await setupChat();c.service.dispose();const original=structuredClone(c.storage.data.get(c.c.conversation.id)!);
    if(kind.startsWith('file')){
      const r=recipient(c.selected);original.lastRecipient=r;
      for(let i=0;i<15;i++){const common={requestId:randomUUID(),runId:randomUUID(),recipient:r,createdAt:original.createdAt,updatedAt:original.updatedAt};
        original.messages.push({...common,id:randomUUID(),role:'user',text:'old',status:'completed',seq:0},{...common,id:randomUUID(),role:'assistant',text:'x'.repeat(65_536),status:'failed',errorCode:'INTERRUPTED',seq:3});}
    }
    c.storage.data.set(original.id,original);const otherBytes=kind.startsWith('total')?CHAT_LIMITS.totalBytes-Buffer.byteLength(JSON.stringify(original))-40_000:0;
    const entered=deferred<void>(),release=deferred<void>();
    c.storage.commit.mockImplementation(async next=>{
      const bytes=Buffer.byteLength(JSON.stringify(next));
      if(bytes>CHAT_LIMITS.conversationBytes||bytes+otherBytes>CHAT_LIMITS.totalBytes){entered.resolve();await release.promise;throw new ChatError('LIMIT_REACHED');}
      c.storage.data.set(next.id,structuredClone(next));
    });
    const service=new ChatService(c.storage,c.providers,c.adapter),owner={},terminal=deferred<ChatEvent>();
    const sub=await service.subscribe(owner,original.id,event=>{if(event.type==='failed')terminal.resolve(event);});
    const plan=await service.prepareSend(owner,{conversationId:original.id,expectedRevision:original.revision,requestId:randomUUID(),text:'next'});
    if(kind.endsWith('checkpoint'))vi.useFakeTimers();
    await service.send(owner,{planId:plan.id,subscriptionId:sub.subscriptionId});await c.requested.promise;c.deliver('y'.repeat(60_000));
    if(kind.endsWith('checkpoint'))await vi.advanceTimersByTimeAsync(1000);else c.network.resolve('stop');
    await entered.promise;release.resolve();
    expect(await terminal.promise).toMatchObject({type:'failed',persisted:false,message:{errorCode:'LIMIT_REACHED'}});
    const view=await service.snapshot(original.id);expect(view.persistence).toBe('failed');
    await expect(service.prepareSend(owner,{conversationId:original.id,expectedRevision:view.conversation.revision,requestId:randomUUID(),text:'again'})).rejects.toThrow('LIMIT_REACHED');
    expect(c.adapter.stream).toHaveBeenCalledOnce();service.dispose();
  });
  it('aligns a mid-batch snapshot watermark with text, so following deltas never duplicate buffered text', async () => {
    vi.useFakeTimers();const c=await setupChat();await start(c);c.deliver('first');
    let view=await c.service.snapshot(c.c.conversation.id);expect(view.conversation.messages.at(-1)?.text).toBe('first');
    const watermark=view.watermark.seq;c.deliver('second');await vi.advanceTimersByTimeAsync(50);
    for(const event of c.events.filter(e=>e.seq>watermark))view=applyChatEvent(view,event).snapshot;
    expect(view.conversation.messages.at(-1)?.text).toBe('firstsecond');c.network.resolve('stop');await c.terminal.promise;c.service.dispose();
  });
  it('keeps a queued committing snapshot below the terminal sequence until actual persistence, preserving the completion event', async () => {
    vi.useFakeTimers();const c=await setupChat();const {plan}=await start(c);c.deliver('complete');
    const checkpoint=deferred<void>(),release=deferred<void>();
    c.storage.commit.mockImplementationOnce(async value=>{checkpoint.resolve();await release.promise;c.storage.data.set(value.id,structuredClone(value));});
    await vi.advanceTimersByTimeAsync(1000);await checkpoint.promise;
    const snapshot=c.service.snapshot(c.c.conversation.id);c.network.resolve('stop');await vi.advanceTimersByTimeAsync(0);
    expect(c.service.cancel(c.owner,plan.requestId)).toEqual({status:'committing'});release.resolve();
    const view=await snapshot;expect(view.active?.phase).toBe('committing');expect(view.conversation.messages.at(-1)?.status).toBe('streaming');
    const event=await c.terminal.promise;expect(event.seq).toBe(view.watermark.seq+1);
    const applied=applyChatEvent(view,event);expect(applied.state).toBe('applied');expect(applied.snapshot.persistence).toBe('saved');expect(applied.snapshot.active).toBeNull();c.service.dispose();
  });
  it('requires a stopped terminal and fresh revision before explicitly deleting an active conversation', async () => {
    const c=await setupChat();await start(c);c.deliver('partial');
    const current=await c.service.snapshot(c.c.conversation.id);
    await expect(c.service.remove({conversationId:current.conversation.id,expectedRevision:current.conversation.revision})).rejects.toThrow('BUSY');
    await c.terminal.promise;expect(c.signal().aborted).toBe(true);
    const terminal=await c.service.snapshot(c.c.conversation.id);await c.service.remove({conversationId:terminal.conversation.id,expectedRevision:terminal.conversation.revision});
    expect(c.storage.data.has(terminal.conversation.id)).toBe(false);expect(await c.service.list()).toEqual([]);c.service.dispose();
  });
  it('aborts on a checkpoint failure and reports saved only after the full failed terminal is durably recorded', async () => {
    vi.useFakeTimers();const c=await setupChat();await start(c);c.deliver('checkpoint partial');
    c.storage.commit.mockRejectedValueOnce(new Error('mock checkpoint failure'));await vi.advanceTimersByTimeAsync(1000);
    expect(await c.terminal.promise).toMatchObject({type:'failed',persisted:true,message:{errorCode:'STORE_FAILED',text:'checkpoint partial'}});
    expect(c.signal().aborted).toBe(true);expect((await c.service.snapshot(c.c.conversation.id)).persistence).toBe('saved');
    expect((await c.prepare('explicit retry')).disclosure).toMatchObject({assistantMessages:0});c.service.dispose();
  });
  it('cancels a queued prepare before it registers a plan', async () => {
    const c = await setupChat(), blocked = deferred<void>(), release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (value) => { blocked.resolve(); await release.promise; c.storage.data.set(value.id,structuredClone(value)); });
    const creating = c.service.create(); await blocked.promise;
    const requestId = randomUUID(); const prepare = c.service.prepareSend(c.owner,{conversationId:c.c.conversation.id,expectedRevision:1,requestId,text:'queued'});
    const rejected = expect(prepare).rejects.toThrow('CANCELLED');
    expect(c.service.cancel(c.owner,requestId)).toEqual({status:'stopping'}); release.resolve(); await creating; await rejected;
    expect(c.adapter.stream).not.toHaveBeenCalled(); c.service.dispose();
  });
  it.each(['cancel','close'] as const)('aborts before network when %s occurs during the initial message commit', async (action) => {
    const c = await setupChat(), plan = await c.prepare(), blocked = deferred<void>(), release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (value) => { blocked.resolve(); await release.promise; c.storage.data.set(value.id,structuredClone(value)); });
    const sending = c.service.send(c.owner,{planId:plan.id,subscriptionId:c.sub.subscriptionId}); await blocked.promise;
    if (action === 'close') c.service.closeOwner(c.owner); else c.service.cancel(c.owner,plan.requestId);
    release.resolve(); await sending;
    await vi.waitFor(() => expect(c.storage.data.get(c.c.conversation.id)?.messages.at(-1)?.status).toBe('stopped'));
    expect(c.adapter.stream).not.toHaveBeenCalled(); c.service.dispose();
  });
  it('physically aborts a running request and rejects late deltas', async () => {
    const c = await setupChat(); const { plan } = await start(c); c.deliver('partial');
    expect(c.service.cancel(c.owner,plan.requestId)).toEqual({status:'stopping'}); expect(c.signal().aborted).toBe(true);
    expect(() => c.deliver('late')).toThrow('CANCELLED'); c.network.resolve('stop');
    const terminal = await c.terminal.promise; expect(terminal.type).toBe('stopped');
    expect(c.events.filter((e) => ['completed','failed','stopped'].includes(e.type))).toHaveLength(1);
    expect(c.storage.data.get(c.c.conversation.id)?.messages.at(-1)).toMatchObject({text:'partial',status:'stopped'}); c.service.dispose();
  });
  it.each(['cancel','close'] as const)('refuses fictitious cancellation in final commit (%s)', async (action) => {
    const c = await setupChat(); const { plan } = await start(c); c.deliver('complete');
    const blocked = deferred<void>(), release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (value) => { blocked.resolve(); await release.promise; c.storage.data.set(value.id,structuredClone(value)); });
    c.network.resolve('stop'); await blocked.promise;
    if (action === 'close') c.service.closeOwner(c.owner);
    expect(c.service.cancel(c.owner,plan.requestId)).toEqual({status:'committing'});
    release.resolve(); await vi.waitFor(() => expect(c.storage.data.get(c.c.conversation.id)?.messages.at(-1)?.status).toBe('completed'));
    expect(c.adapter.stream).toHaveBeenCalledOnce(); c.service.dispose();
  });
  it('fails admission without sending when message persistence fails, and cannot reuse the plan', async () => {
    const c = await setupChat(), plan = await c.prepare(); c.storage.commit.mockRejectedValueOnce(new Error('private-disk-error'));
    await expect(c.service.send(c.owner,{planId:plan.id,subscriptionId:c.sub.subscriptionId})).rejects.toThrow('STORE_FAILED');
    await expect(c.service.send(c.owner,{planId:plan.id,subscriptionId:c.sub.subscriptionId})).rejects.toThrow('REPLAY');
    expect(c.adapter.stream).not.toHaveBeenCalled(); expect(c.storage.data.get(c.c.conversation.id)?.messages).toEqual([]); c.service.dispose();
  });
  it('reports failed final persistence, blocks follow-up sends and repairs unfinished disk records after restart', async () => {
    const c = await setupChat(); await start(c); c.deliver('partial on disk failure');
    c.storage.commit.mockRejectedValueOnce(new Error('private-disk-error')); c.network.resolve('stop');
    const event = await c.terminal.promise; expect(event).toMatchObject({type:'failed',persisted:false,message:{errorCode:'STORE_FAILED'}});
    const view = await c.service.snapshot(c.c.conversation.id); expect(view.persistence).toBe('failed');
    await expect(c.prepare()).rejects.toThrow('STORE_FAILED');
    const restart = new ChatService(c.storage,c.providers,c.adapter); const restored = await restart.snapshot(c.c.conversation.id);
    expect(restored.conversation.messages.at(-1)).toMatchObject({status:'failed',errorCode:'INTERRUPTED'});
    expect(c.adapter.stream).toHaveBeenCalledOnce(); c.service.dispose(); restart.dispose();
  });
  it.each([['length','OUTPUT_TRUNCATED'],['content_filter','CONTENT_FILTERED']] as const)('keeps %s as a failed partial answer', async (finish,code) => {
    const c = await setupChat(); await start(c); c.deliver('partial'); c.network.resolve(finish);
    expect(await c.terminal.promise).toMatchObject({type:'failed',message:{finishReason:finish,errorCode:code}}); c.service.dispose();
  });
  it('shows a waiting event without aborting a live stream solely for lack of visible text', async () => {
    vi.useFakeTimers(); const c = await setupChat(); const { plan } = await start(c);
    await vi.advanceTimersByTimeAsync(60_001); expect(c.events.some((e) => e.type === 'waiting')).toBe(true); expect(c.signal().aborted).toBe(false);
    c.service.cancel(c.owner,plan.requestId); await c.terminal.promise; c.service.dispose();
  });
  it('bounds overall generation time and preserves a unique timeout terminal', async () => {
    vi.useFakeTimers(); const c = await setupChat(); await start(c);
    await vi.advanceTimersByTimeAsync(CHAT_LIMITS.totalMs);
    expect(await c.terminal.promise).toMatchObject({type:'failed',message:{errorCode:'TIMEOUT'}}); expect(c.signal().aborted).toBe(true); c.service.dispose();
  });
  it('fails closed on corrupt stored data, rather than resetting it', async () => {
    const storage = new MemoryConversationStorage(); storage.load.mockResolvedValueOnce([{id:'bad'}] as never);
    const c = new ChatService(storage,{} as never,{} as never); await expect(c.list()).rejects.toThrow('STORE_CORRUPT'); expect(storage.commit).not.toHaveBeenCalled();
  });
  it('creates a monotonic snapshot watermark and ignores repeated or out-of-order events', async () => {
    const c = await setupChat(); await start(c); c.deliver('one'); c.network.resolve('stop'); await c.terminal.promise;
    const [first,delta,terminal] = c.events as [ChatEvent,ChatEvent,ChatEvent]; const initial = applyChatEvent(c.sub.snapshot,first).snapshot;
    expect(applyChatEvent(initial,first).state).toBe('duplicate'); expect(applyChatEvent(initial,terminal).state).toBe('gap');
    expect(applyChatEvent(applyChatEvent(initial,delta).snapshot,terminal).state).toBe('applied'); c.service.dispose();
  });
});
