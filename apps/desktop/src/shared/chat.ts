export const CHAT_CHANNELS = {
  list: 'bubu:chat:list', create: 'bubu:chat:create', remove: 'bubu:chat:remove',
  subscribe: 'bubu:chat:subscribe', unsubscribe: 'bubu:chat:unsubscribe', snapshot: 'bubu:chat:snapshot',
  prepareSend: 'bubu:chat:prepare-send', send: 'bubu:chat:send', cancel: 'bubu:chat:cancel',
} as const;
export const CHAT_EVENT_CHANNEL = 'bubu:chat:event';
export const CHAT_LIMITS = {
  inputBytes: 16_384, contextBytes: 131_072, outputBytes: 65_536, eventBytes: 65_536,
  responseBytes: 2_097_152, events: 8192, conversationBytes: 1_048_576,
  totalBytes: 20_971_520, conversations: 100, messages: 200, completionTokens: 2048,
  planMs: 60_000, totalMs: 300_000, idleMs: 60_000, visibleWaitMs: 60_000,
} as const;
export const CHAT_ERROR_CODES = ['INVALID_INPUT','UNTRUSTED_SENDER','NOT_FOUND','CONFLICT','BUSY','LIMIT_REACHED',
  'NOT_READY','CREDENTIAL_UNAVAILABLE','STORAGE_UNAVAILABLE','STORE_FAILED','STORE_CORRUPT',
  'SUBSCRIPTION_REQUIRED','PLAN_EXPIRED','CONSENT_REQUIRED','REPLAY','CANCELLED','PROVIDER_CHANGED',
  'URL_BLOCKED','DNS_BLOCKED','DNS_FAILED','REDIRECT_BLOCKED','TLS_FAILED','TIMEOUT','NETWORK_IDLE',
  'NETWORK_FAILED','AUTH_FAILED','MODEL_NOT_FOUND','RATE_LIMITED','PROTOCOL_ERROR','RESPONSE_TOO_LARGE',
  'OUTPUT_TRUNCATED','CONTENT_FILTERED','TOOLS_FORBIDDEN','EMPTY_RESPONSE','INTERRUPTED'] as const;
export type ChatErrorCode = typeof CHAT_ERROR_CODES[number];
export type ChatResult<T> = { ok: true; value: T } | { ok: false; error: { code: ChatErrorCode } };
export interface ChatRecipient { providerId: string; revision: number; name: string; baseUrl: string; origin: string; modelId: string }
export type ChatStatus = 'pending' | 'streaming' | 'completed' | 'stopped' | 'failed';
export interface ChatMessage {
  id: string; requestId: string; runId: string; role: 'user' | 'assistant'; text: string; status: ChatStatus;
  recipient: ChatRecipient; createdAt: string; updatedAt: string; seq: number;
  finishReason?: 'stop' | 'length' | 'content_filter' | undefined; errorCode?: ChatErrorCode | undefined;
}
export interface Conversation {
  schemaVersion: 1; id: string; revision: number; title: string; createdAt: string; updatedAt: string;
  lastRecipient: ChatRecipient | null; messages: ChatMessage[];
}
export interface ConversationSummary { id: string; revision: number; title: string; updatedAt: string; messageCount: number }
export interface ChatSnapshot {
  sessionId: string; conversation: Conversation;
  watermark: { runId: string | null; seq: number };
  active: { requestId: string; runId: string; phase: 'preparing' | 'streaming' | 'committing' } | null;
  persistence: 'saved' | 'pending' | 'failed';
}
export interface SendPlan {
  id: string; requestId: string; conversationId: string; conversationRevision: number;
  recipient: ChatRecipient; expiresAt: number; requiresConsent: boolean;
  disclosure: { userMessages: number; assistantMessages: number; utf8Bytes: number; digest: string; currentInputIncluded: true };
}
export interface PrepareSendInput { conversationId: string; expectedRevision: number; requestId: string; text: string }
export interface SendInput { planId: string; subscriptionId: string; accepted?: true | undefined }
export interface ChatTarget { conversationId: string }
export interface RemoveChatInput extends ChatTarget { expectedRevision: number }
export interface SubscriptionReady { subscriptionId: string; snapshot: ChatSnapshot }
export interface ChatCancelOutcome { status: 'stopping' | 'committing' | 'not-running' }
interface EventBase {
  sessionId: string; subscriptionId: string; conversationId: string; requestId: string; runId: string;
  seq: number; revision: number;
}
export type ChatEventPayload = (
  { type: 'started'; user: ChatMessage; message: ChatMessage; title: string } |
  { type: 'delta'; text: string } | { type: 'waiting' } |
  { type: 'completed' | 'stopped' | 'failed'; message: ChatMessage; persisted: boolean }
);
export type ChatEvent = EventBase & ChatEventPayload;
// Preload emits an authoritative replacement after a lost/out-of-order event.
export type ChatUpdate = ChatEvent | { type: 'resync'; subscriptionId: string; snapshot: ChatSnapshot };
export interface ChatApi {
  list(): Promise<ChatResult<ConversationSummary[]>>;
  create(): Promise<ChatResult<ChatSnapshot>>;
  remove(input: RemoveChatInput): Promise<ChatResult<void>>;
  subscribe(input: ChatTarget, callback: (event: ChatUpdate) => void): Promise<ChatResult<SubscriptionReady>>;
  unsubscribe(input: { subscriptionId: string }): Promise<ChatResult<void>>;
  snapshot(input: ChatTarget): Promise<ChatResult<ChatSnapshot>>;
  prepareSend(input: PrepareSendInput): Promise<ChatResult<SendPlan>>;
  send(input: SendInput): Promise<ChatResult<{ requestId: string; runId: string }>>;
  cancel(input: { requestId: string }): Promise<ChatResult<ChatCancelOutcome>>;
}

const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
function isRecipient(v: unknown): v is ChatRecipient {
  return record(v) && keys(v, ['providerId','revision','name','baseUrl','origin','modelId']) && id(v.providerId) && integer(v.revision) &&
    ['name','baseUrl','origin','modelId'].every((k) => typeof v[k] === 'string' && (v[k] as string).length <= 2048);
}
function isMessage(v: unknown): v is ChatMessage {
  return record(v) && keys(v, ['id','requestId','runId','role','text','status','recipient','createdAt','updatedAt','seq','finishReason','errorCode']) &&
    id(v.id) && id(v.requestId) && id(v.runId) && ['user','assistant'].includes(v.role as string) &&
    ['pending','streaming','completed','stopped','failed'].includes(v.status as string) && typeof v.text === 'string' && v.text.length <= CHAT_LIMITS.outputBytes &&
    typeof v.createdAt === 'string' && v.createdAt.length <= 40 && typeof v.updatedAt === 'string' && v.updatedAt.length <= 40 &&
    integer(v.seq) && isRecipient(v.recipient) && (v.finishReason === undefined || ['stop','length','content_filter'].includes(v.finishReason as string)) &&
    (v.errorCode === undefined || (CHAT_ERROR_CODES as readonly unknown[]).includes(v.errorCode));
}
export function isChatSnapshot(v: unknown): v is ChatSnapshot {
  if (!record(v) || !keys(v, ['sessionId','conversation','watermark','active','persistence']) || !id(v.sessionId) || !record(v.conversation) || !record(v.watermark)) return false;
  const c = v.conversation;
  return keys(c, ['schemaVersion','id','revision','title','createdAt','updatedAt','lastRecipient','messages']) && c.schemaVersion === 1 && id(c.id) && integer(c.revision) &&
    typeof c.title === 'string' && c.title.length <= 80 && typeof c.createdAt === 'string' && typeof c.updatedAt === 'string' &&
    (c.lastRecipient === null || isRecipient(c.lastRecipient)) && Array.isArray(c.messages) && c.messages.length <= CHAT_LIMITS.messages && c.messages.every(isMessage) &&
    keys(v.watermark, ['runId','seq']) && (v.watermark.runId === null || id(v.watermark.runId)) && integer(v.watermark.seq) &&
    (v.active === null || record(v.active) && keys(v.active, ['requestId','runId','phase']) && id(v.active.requestId) && id(v.active.runId) && ['preparing','streaming','committing'].includes(v.active.phase as string)) &&
    ['saved','pending','failed'].includes(v.persistence as string) && JSON.stringify(c).length <= CHAT_LIMITS.conversationBytes;
}
export function isChatEvent(v: unknown): v is ChatEvent {
  if (!record(v) || !['sessionId','subscriptionId','conversationId','requestId','runId'].every((k) => id(v[k])) || !integer(v.seq) || !integer(v.revision)) return false;
  const base = ['sessionId','subscriptionId','conversationId','requestId','runId','seq','revision','type'];
  if (v.type === 'delta') return keys(v, [...base,'text']) && typeof v.text === 'string' && v.text.length <= CHAT_LIMITS.outputBytes;
  if (v.type === 'waiting') return keys(v, base);
  if (v.type === 'started') return keys(v, [...base,'user','message','title']) && typeof v.title === 'string' && v.title.length <= 80 && isMessage(v.user) && isMessage(v.message) &&
    v.user.role === 'user' && v.message.role === 'assistant' && v.user.runId === v.runId && v.message.runId === v.runId &&
    v.user.requestId === v.requestId && v.message.requestId === v.requestId && v.seq === 1 && v.message.seq === 1;
  return ['completed','stopped','failed'].includes(v.type as string) && keys(v, [...base,'message','persisted']) && isMessage(v.message) &&
    v.message.role === 'assistant' && v.message.runId === v.runId && v.message.requestId === v.requestId && v.message.seq === v.seq &&
    v.message.status === v.type && typeof v.persisted === 'boolean';
}

// Pure contract reducer for the future Renderer. No UI, Node or Electron dependencies.
export function applyChatEvent(snapshot: ChatSnapshot, event: ChatEvent): { state: 'applied' | 'duplicate' | 'gap' | 'irrelevant'; snapshot: ChatSnapshot } {
  if (snapshot.sessionId !== event.sessionId || snapshot.conversation.id !== event.conversationId) return { state: 'irrelevant', snapshot };
  const sameRun = snapshot.watermark.runId === event.runId;
  if (sameRun && event.seq <= snapshot.watermark.seq) return { state: 'duplicate', snapshot };
  if ((!sameRun && (event.type !== 'started' || event.seq !== 1)) || (sameRun && event.seq !== snapshot.watermark.seq + 1)) return { state: 'gap', snapshot };
  const next = structuredClone(snapshot);
  next.watermark = { runId: event.runId, seq: event.seq };
  next.conversation.revision = event.revision;
  if (event.type === 'started') {
    if (next.conversation.messages.some((m) => m.runId === event.runId)) return { state: 'gap', snapshot };
    next.conversation.messages.push(event.user, event.message);
    next.conversation.lastRecipient = event.message.recipient;
    next.conversation.title = event.title;
    next.conversation.updatedAt = event.message.updatedAt;
    next.active = { requestId: event.requestId, runId: event.runId, phase: 'preparing' };
    next.persistence = 'pending';
  } else {
    const message = next.conversation.messages.at(-1);
    if (!message || message.runId !== event.runId || !['pending','streaming'].includes(message.status)) return { state: 'irrelevant', snapshot };
    message.seq = event.seq;
    if (event.type === 'delta') { message.text += event.text; message.status = 'streaming'; if (next.active) next.active.phase = 'streaming'; next.persistence = 'pending'; }
    else if (event.type !== 'waiting') {
      next.conversation.messages[next.conversation.messages.length - 1] = event.message;
      next.conversation.updatedAt = event.message.updatedAt;
      next.active = null; next.persistence = event.persisted ? 'saved' : 'failed';
    }
  }
  return { state: 'applied', snapshot: next };
}
