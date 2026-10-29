import { CHAT_CHANNELS, CHAT_EVENT_CHANNEL, applyChatEvent, isChatEvent, isChatSnapshot } from '../shared/chat';
import type { ChatApi, ChatEvent, ChatResult, ChatSnapshot, SubscriptionReady } from '../shared/chat';

interface Ipc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): unknown;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): unknown;
}
export function createChatBridge(ipc: Ipc): Readonly<ChatApi> {
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<ChatResult<T>> => {
    try { return await ipc.invoke(channel, ...args) as ChatResult<T>; }
    catch { return { ok: false, error: { code: 'NETWORK_FAILED' } }; }
  };
  let current: { close: () => void } | undefined;
  const listeners = new Map<string, (notify?: boolean) => void>();
  return Object.freeze({
    list: () => invoke(CHAT_CHANNELS.list), create: () => invoke(CHAT_CHANNELS.create),
    remove: (input) => invoke(CHAT_CHANNELS.remove, input), snapshot: (input) => invoke(CHAT_CHANNELS.snapshot, input),
    prepareSend: (input) => invoke(CHAT_CHANNELS.prepareSend, input), send: (input) => invoke(CHAT_CHANNELS.send, input),
    cancel: (input) => invoke(CHAT_CHANNELS.cancel, input),
    unsubscribe: async (input) => { listeners.get(input.subscriptionId)?.(false); return invoke(CHAT_CHANNELS.unsubscribe, input); },
    subscribe: async (input, callback) => {
      current?.close();
      let ready: SubscriptionReady | undefined, closed = false, recovering = false, snapshot: ChatSnapshot | undefined;
      let recoveryAttempts = 0;
      let buffer: ChatEvent[] = [], overflow = false;
      const close = (notify = true) => {
        closed = true; buffer = []; ipc.removeListener(CHAT_EVENT_CHANNEL, listener);
        if (ready) { listeners.delete(ready.subscriptionId); if (notify) void invoke(CHAT_CHANNELS.unsubscribe, { subscriptionId: ready.subscriptionId }).catch(() => {}); }
        if (current?.close === close) current = undefined;
      };
      const deliver = (value: ChatEvent) => {
        if (closed || !ready || value.subscriptionId !== ready.subscriptionId || value.sessionId !== ready.snapshot.sessionId || value.conversationId !== input.conversationId) return;
        const result = applyChatEvent(snapshot!, value);
        if (result.state === 'gap') { if (buffer.length < 128) buffer.push(value); else overflow = true; void recover(); return; }
        if (result.state === 'applied') { recoveryAttempts = 0; snapshot = result.snapshot; try { callback(value); } catch { close(); } }
      };
      const recover = async () => {
        if (recovering || closed || !ready) return;
        if (++recoveryAttempts > 2) { close(); return; }
        recovering = true;
        try {
          const result = await invoke<ChatSnapshot>(CHAT_CHANNELS.snapshot, input);
          if (!closed && result.ok && isChatSnapshot(result.value) && result.value.sessionId === ready.snapshot.sessionId) {
            snapshot = result.value; overflow = false;
            callback({ type: 'resync', subscriptionId: ready.subscriptionId, snapshot: structuredClone(snapshot) });
            const queued = buffer; buffer = [];
            for (const e of queued) deliver(e);
          } else close();
        } catch { close(); } finally {
          recovering = false;
          if (!closed && (buffer.length || overflow)) queueMicrotask(() => { void recover(); });
        }
      };
      const listener = (_event: unknown, value: unknown) => {
        if (closed || !isChatEvent(value)) return;
        if (!ready || recovering) {
          if (buffer.length < 128) buffer.push(value); else { overflow = true; buffer = []; }
        } else deliver(value);
      };
      current = { close }; ipc.on(CHAT_EVENT_CHANNEL, listener); // Must precede the invoke.
      try {
        const result = await invoke<SubscriptionReady>(CHAT_CHANNELS.subscribe, input);
        if (!result.ok) { close(); return result; }
        ready = result.value;
        if (!isChatSnapshot(ready.snapshot) || typeof ready.subscriptionId !== 'string' || ready.snapshot.conversation.id !== input.conversationId) {
          close(); return { ok: false, error: { code: 'PROTOCOL_ERROR' } };
        }
        if (closed) { void invoke(CHAT_CHANNELS.unsubscribe, { subscriptionId: ready.subscriptionId }).catch(() => {}); return { ok: false, error: { code: 'CANCELLED' } }; }
        listeners.set(ready.subscriptionId, close); snapshot = structuredClone(ready.snapshot);
        const queued = buffer; buffer = [];
        if (overflow) await recover(); else for (const e of queued) deliver(e);
        return { ok: true, value: { ...ready, snapshot: structuredClone(snapshot) } };
      } catch { close(); return { ok: false, error: { code: 'NETWORK_FAILED' } }; }
    },
  } satisfies ChatApi);
}
