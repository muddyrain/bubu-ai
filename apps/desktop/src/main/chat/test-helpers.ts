import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type { ChatEvent, ChatRecipient, ChatSnapshot, Conversation } from '../../shared/chat';
import type { ProviderProfile } from '../../shared/providers';
import { deferred } from '../providers/test-helpers';
import type { ConversationStorage } from './conversation-store';
import type { ChatAdapter } from './openai-chat-stream';
import type { ChatProviderAccess } from './chat-service';
import { ChatService } from './chat-service';
export { deferred };
export const profile = (): ProviderProfile => { const id = randomUUID(); return { id, revision: 1, name: 'Mock provider',
  protocol: 'openai-compatible-chat-completions', baseUrl: 'https://provider.example/v1', modelId: 'mock-model', enabled: true,
  hasKey: true, connection: { profileId: id, probeVersion: 1, revision: 1, requestId: randomUUID(), outcome: 'passed', checkedAt: new Date().toISOString() },
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; };
export const recipient = (p = profile()): ChatRecipient => ({ providerId: p.id, revision: p.revision, name: p.name,
  baseUrl: p.baseUrl, origin: new URL(p.baseUrl).origin, modelId: p.modelId });
export const empty = (): Conversation => ({ schemaVersion: 1, id: randomUUID(), revision: 1, title: 'Mock conversation',
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastRecipient: null, messages: [] });
export const snapshot = (conversation = empty()): ChatSnapshot => ({ sessionId: randomUUID(), conversation,
  watermark: { runId: conversation.messages.at(-1)?.runId ?? null, seq: conversation.messages.at(-1)?.seq ?? 0 }, active: null, persistence: 'saved' });
export class MemoryConversationStorage implements ConversationStorage {
  data = new Map<string, Conversation>();
  load = vi.fn(async () => structuredClone([...this.data.values()]));
  commit = vi.fn(async (c: Conversation) => { this.data.set(c.id, structuredClone(c)); });
  remove = vi.fn(async (id: string) => { this.data.delete(id); });
}
export async function setupChat(storage = new MemoryConversationStorage()) {
  const selected = profile(); const network = deferred<'stop' | 'length' | 'content_filter'>(); const requested = deferred<void>();
  let deliver!: (text: string) => void, signal!: AbortSignal;
  const providers: ChatProviderAccess = {
    selectedChatProfile: vi.fn(async () => selected),
    withSelectedChatAccess: vi.fn(async (_target, outer, use) => use(selected, 'mock-only-secret', outer)),
  };
  const adapter: ChatAdapter = { stream: vi.fn(async (_r, _key, _messages, s, onText) => {
    signal = s; deliver = onText; requested.resolve();
    return Promise.race([network.promise, new Promise<never>((_ok, reject) => {
      if (s.aborted) reject(s.reason); else s.addEventListener('abort', () => reject(s.reason), { once: true });
    })]);
  }) };
  const service = new ChatService(storage, providers, adapter); const c = await service.create();
  const owner = {}, events: ChatEvent[] = []; const terminal = deferred<ChatEvent>();
  const sub = await service.subscribe(owner, c.conversation.id, (e) => { events.push(e); if (['completed','stopped','failed'].includes(e.type)) terminal.resolve(e); });
  const prepare = (text = '你好') => service.prepareSend(owner, { conversationId: c.conversation.id,
    expectedRevision: storage.data.get(c.conversation.id)!.revision, requestId: randomUUID(), text });
  return { service, storage, selected, providers, adapter, network, requested, owner, events, terminal, sub, c, prepare,
    deliver: (text: string) => deliver(text), signal: () => signal };
}
