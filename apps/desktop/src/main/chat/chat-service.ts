import { createHash, randomUUID } from 'node:crypto';
import { CHAT_LIMITS } from '../../shared/chat';
import type { ChatCancelOutcome, ChatEvent, ChatEventPayload, ChatMessage, ChatRecipient, ChatSnapshot, Conversation, ConversationSummary,
  PrepareSendInput, RemoveChatInput, SendInput, SendPlan, SubscriptionReady } from '../../shared/chat';
import type { ProviderProfile, ProfileTarget } from '../../shared/providers';
import type { ConversationStorage } from './conversation-store';
import { ChatError, chatCode, checkSignal, persistenceCode } from './errors';
import type { ChatErrorCode } from '../../shared/chat';
import type { ChatAdapter, ContextMessage } from './openai-chat-stream';
import { prepareSchema, removeSchema, sendSchema, uuid, validateConversation } from './schemas';

export interface ChatProviderAccess {
  selectedChatProfile(): Promise<ProviderProfile>;
  withSelectedChatAccess<T>(target: ProfileTarget, signal: AbortSignal,
    use: (profile: ProviderProfile, key: string, signal: AbortSignal) => Promise<T>): Promise<T>;
}
interface Subscription { id: string; conversationId: string; emit: (event: ChatEvent) => void }
interface Intent { controller: AbortController; requestId: string; plan?: SendPlan; text: string; subscriptionId: string; timer?: ReturnType<typeof setTimeout> }
interface Run {
  owner: object; conversationId: string; requestId: string; runId: string; controller: AbortController;
  phase: 'preparing' | 'streaming' | 'committing'; message?: ChatMessage; accepted: boolean;
  pendingText: string; deltaTimer?: ReturnType<typeof setTimeout>; checkpoint?: ReturnType<typeof setInterval>;
  waitTimer?: ReturnType<typeof setTimeout>; totalTimer?: ReturnType<typeof setTimeout>; checkpointing: boolean;
  accept: () => void; reject: (error: unknown) => void;
}
const recipient = (p: ProviderProfile): ChatRecipient => ({ providerId: p.id, revision: p.revision, name: p.name,
  baseUrl: p.baseUrl, origin: new URL(p.baseUrl).origin, modelId: p.modelId });
const equalRecipient = (a: ChatRecipient | null, b: ChatRecipient) => a !== null &&
  a.providerId === b.providerId && a.revision === b.revision && a.baseUrl === b.baseUrl && a.modelId === b.modelId;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = () => new Date().toISOString();

export class ChatService {
  readonly sessionId = randomUUID();
  private data = new Map<string, Conversation>();
  private initialized: Promise<void> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private subscriptions = new Map<object, Subscription>();
  private subscriptionEpoch = new WeakMap<object, number>();
  private intents = new Map<object, Intent>();
  private closed = new WeakSet<object>();
  private usedPlans = new WeakMap<object, Set<string>>();
  private knownRequests = new Set<string>();
  private preparing = 0;
  private active: Run | undefined;
  private persistenceFailed = new Map<string, 'LIMIT_REACHED' | 'STORE_FAILED'>();
  private unsaved = new Map<string, ChatMessage>();
  constructor(private readonly storage: ConversationStorage, private readonly providers: ChatProviderAccess, private readonly adapter: ChatAdapter) {}

  private initialize(): Promise<void> {
    return this.initialized ??= (async () => {
      let loaded: Conversation[];
      try { loaded = await this.storage.load(); } catch { throw new ChatError('STORE_CORRUPT'); }
      if (loaded.length > CHAT_LIMITS.conversations) throw new ChatError('STORE_CORRUPT');
      const requests = new Set<string>();
      for (const item of loaded) {
        let c: Conversation;
        try { c = structuredClone(validateConversation(item)); } catch { throw new ChatError('STORE_CORRUPT'); }
        if (this.data.has(c.id)) throw new ChatError('STORE_CORRUPT');
        for (const m of c.messages.filter((m) => m.role === 'user')) {
          if (requests.has(m.requestId)) throw new ChatError('STORE_CORRUPT'); requests.add(m.requestId);
        }
        let recovered = false;
        for (const m of c.messages) if (m.role === 'assistant' && ['pending','streaming'].includes(m.status)) {
          m.status = 'failed'; m.errorCode = 'INTERRUPTED'; m.updatedAt = now(); m.seq++; recovered = true;
        }
        if (recovered) { c.revision++; c.updatedAt = now(); await this.storage.commit(c); }
        this.data.set(c.id, c);
      }
      this.knownRequests = requests;
    })();
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => { await this.initialize(); return work(); });
    this.tail = result.catch(() => {}); return result;
  }
  private conversation(id: string, expected?: number): Conversation {
    if (!uuid.safeParse(id).success) throw new ChatError('INVALID_INPUT');
    const c = this.data.get(id); if (!c) throw new ChatError('NOT_FOUND');
    if (expected !== undefined && c.revision !== expected) throw new ChatError('CONFLICT');
    return c;
  }
  private async publish(c: Conversation): Promise<void> {
    if (c.revision >= Number.MAX_SAFE_INTEGER - 1) throw new ChatError('LIMIT_REACHED');
    try { await this.storage.commit(structuredClone(c)); } catch (error) { throw error instanceof ChatError ? error : new ChatError('STORE_FAILED'); }
    this.data.set(c.id, c);
  }
  private view(id: string): ChatSnapshot {
    const c = structuredClone(this.conversation(id));
    const run = this.active?.conversationId === id ? this.active : undefined;
    // Snapshot text and its watermark must cover exactly the same emitted data.
    if (run && run.phase !== 'committing') this.flush(run);
    const message = run?.message ?? this.unsaved.get(id);
    if (message && c.messages.at(-1)?.runId === message.runId) c.messages[c.messages.length - 1] = structuredClone(message);
    const last = c.messages.at(-1);
    return { sessionId: this.sessionId, conversation: c, watermark: { runId: last?.runId ?? null, seq: last?.seq ?? 0 },
      active: run ? { requestId: run.requestId, runId: run.runId, phase: run.phase } : null,
      persistence: this.persistenceFailed.has(id) ? 'failed' : run ? 'pending' : 'saved' };
  }
  list(): Promise<ConversationSummary[]> {
    return this.serial(async () => [...this.data.values()].map((c) => ({ id: c.id, revision: c.revision, title: c.title,
      updatedAt: c.updatedAt, messageCount: c.messages.length })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  create(): Promise<ChatSnapshot> {
    return this.serial(async () => {
      if (this.active) throw new ChatError('BUSY');
      if (this.data.size >= CHAT_LIMITS.conversations) throw new ChatError('LIMIT_REACHED');
      const c: Conversation = { schemaVersion: 1, id: randomUUID(), revision: 1, title: '新对话', createdAt: now(), updatedAt: now(), lastRecipient: null, messages: [] };
      await this.publish(c); return this.view(c.id);
    });
  }
  snapshot(id: string): Promise<ChatSnapshot> { return this.serial(async () => this.view(id)); }
  remove(input: RemoveChatInput): Promise<void> {
    const parsed = removeSchema.safeParse(input); if (!parsed.success) return Promise.reject(new ChatError('INVALID_INPUT'));
    return this.serial(async () => {
      this.conversation(input.conversationId, input.expectedRevision);
      if (this.active?.conversationId === input.conversationId) {
        if (this.active.phase !== 'committing') this.active.controller.abort(new ChatError('CANCELLED'));
        throw new ChatError('BUSY');
      }
      await this.storage.remove(input.conversationId); this.data.delete(input.conversationId); this.unsaved.delete(input.conversationId); this.persistenceFailed.delete(input.conversationId);
      for (const [owner, sub] of this.subscriptions) if (sub.conversationId === input.conversationId) this.unsubscribe(owner, sub.id);
    });
  }
  subscribe(owner: object, id: string, emit: (event: ChatEvent) => void): Promise<SubscriptionReady> {
    if (this.closed.has(owner)) return Promise.reject(new ChatError('CANCELLED'));
    this.revoke(owner);
    const epoch = (this.subscriptionEpoch.get(owner) ?? 0) + 1; this.subscriptionEpoch.set(owner, epoch);
    return this.serial(async () => {
      if (this.closed.has(owner) || this.subscriptionEpoch.get(owner) !== epoch) throw new ChatError('CANCELLED');
      this.conversation(id);
      const sub = { id: randomUUID(), conversationId: id, emit };
      this.subscriptions.set(owner, sub);
      // Registration and watermark snapshot have no await between them.
      return { subscriptionId: sub.id, snapshot: this.view(id) };
    });
  }
  unsubscribe(owner: object, id: string): void {
    if (this.subscriptions.get(owner)?.id !== id) throw new ChatError('SUBSCRIPTION_REQUIRED');
    this.revoke(owner); this.subscriptionEpoch.set(owner, (this.subscriptionEpoch.get(owner) ?? 0) + 1);
  }
  private dropIntent(owner: object): void {
    const intent = this.intents.get(owner); if (!intent) return;
    clearTimeout(intent.timer); intent.controller.abort(new ChatError('CANCELLED')); this.intents.delete(owner);
  }
  private revoke(owner: object): void {
    this.dropIntent(owner); this.subscriptions.delete(owner);
    if (this.active?.owner === owner && this.active.phase !== 'committing') this.active.controller.abort(new ChatError('CANCELLED'));
  }
  closeOwner(owner: object): void { this.closed.add(owner); this.revoke(owner); }
  dispose(): void { for (const owner of this.subscriptions.keys()) this.closeOwner(owner); for (const owner of this.intents.keys()) this.closeOwner(owner); }
  private subscription(owner: object, id: string, conversationId: string): void {
    const sub = this.subscriptions.get(owner);
    if (this.closed.has(owner) || sub?.id !== id || sub.conversationId !== conversationId) throw new ChatError('SUBSCRIPTION_REQUIRED');
  }
  private context(c: Conversation, text: string): ContextMessage[] {
    const messages: ContextMessage[] = [];
    for (let i = 0; i < c.messages.length; i += 2) {
      const user = c.messages[i]!, assistant = c.messages[i + 1]!;
      if (assistant.status === 'completed' && assistant.finishReason === 'stop') messages.push({ role: 'user', content: user.text }, { role: 'assistant', content: assistant.text });
    }
    messages.push({ role: 'user', content: text });
    if (Buffer.byteLength(JSON.stringify(messages)) > CHAT_LIMITS.contextBytes) throw new ChatError('LIMIT_REACHED');
    return messages;
  }
  prepareSend(owner: object, input: PrepareSendInput): Promise<SendPlan> {
    const parsed = prepareSchema.safeParse(input); if (!parsed.success) return Promise.reject(new ChatError('INVALID_INPUT'));
    const sub = this.subscriptions.get(owner);
    if (this.closed.has(owner) || !sub || sub.conversationId !== input.conversationId) return Promise.reject(new ChatError('SUBSCRIPTION_REQUIRED'));
    if (this.active || this.intents.has(owner) || this.preparing >= 2) return Promise.reject(new ChatError('BUSY'));
    if (this.knownRequests.has(input.requestId)) return Promise.reject(new ChatError('REPLAY'));
    if (this.knownRequests.size >= 20_000) return Promise.reject(new ChatError('LIMIT_REACHED'));
    this.knownRequests.add(input.requestId); // Global, synchronous reservation, including other owners/conversations.
    const intent: Intent = { controller: new AbortController(), requestId: input.requestId, text: input.text, subscriptionId: sub.id };
    this.intents.set(owner, intent); this.preparing++;
    return this.serial(async () => {
      checkSignal(intent.controller.signal); this.subscription(owner, sub.id, input.conversationId);
      const c = this.conversation(input.conversationId, input.expectedRevision);
      if (this.persistenceFailed.has(c.id)) throw new ChatError(this.persistenceFailed.get(c.id)!);
      if (c.messages.length + 2 > CHAT_LIMITS.messages) throw new ChatError('LIMIT_REACHED');
      const messages = this.context(c, input.text);
      const target = recipient(await this.providers.selectedChatProfile());
      checkSignal(intent.controller.signal); this.subscription(owner, sub.id, c.id);
      const plan: SendPlan = { id: randomUUID(), requestId: input.requestId, conversationId: c.id, conversationRevision: c.revision,
        recipient: target, expiresAt: Date.now() + CHAT_LIMITS.planMs,
        requiresConsent: messages.length > 1 && !equalRecipient(c.lastRecipient, target),
        disclosure: { userMessages: messages.filter((m) => m.role === 'user').length,
          assistantMessages: messages.filter((m) => m.role === 'assistant').length, utf8Bytes: Buffer.byteLength(JSON.stringify(messages)), digest: digest(messages), currentInputIncluded: true } };
      intent.plan = plan;
      intent.timer = setTimeout(() => { if (this.intents.get(owner) === intent) this.dropIntent(owner); }, CHAT_LIMITS.planMs);
      return structuredClone(plan);
    }).catch((error: unknown) => { if (this.intents.get(owner) === intent) this.dropIntent(owner); throw error; }).finally(() => { this.preparing--; });
  }
  cancel(owner: object, requestId: string): ChatCancelOutcome {
    const intent = this.intents.get(owner);
    if (intent?.requestId === requestId) { this.dropIntent(owner); return { status: 'stopping' }; }
    const run = this.active;
    if (!run || run.owner !== owner || run.requestId !== requestId) return { status: 'not-running' };
    if (run.phase === 'committing') return { status: 'committing' };
    run.controller.abort(new ChatError('CANCELLED')); return { status: 'stopping' };
  }
  send(owner: object, input: SendInput): Promise<{ requestId: string; runId: string }> {
    const parsed = sendSchema.safeParse(input); if (!parsed.success) return Promise.reject(new ChatError('INVALID_INPUT'));
    const intent = this.intents.get(owner), plan = intent?.plan;
    if (this.usedPlans.get(owner)?.has(input.planId)) return Promise.reject(new ChatError('REPLAY'));
    if (!intent || !plan || plan.id !== input.planId) return Promise.reject(new ChatError('PLAN_EXPIRED'));
    try {
      checkSignal(intent.controller.signal); this.subscription(owner, input.subscriptionId, plan.conversationId);
      if (input.subscriptionId !== intent.subscriptionId) throw new ChatError('SUBSCRIPTION_REQUIRED');
      if (Date.now() >= plan.expiresAt) { this.dropIntent(owner); throw new ChatError('PLAN_EXPIRED'); }
      if (plan.requiresConsent && !input.accepted) throw new ChatError('CONSENT_REQUIRED');
      if (this.active) throw new ChatError('BUSY');
    } catch (error) { return Promise.reject(error); }
    const used = this.usedPlans.get(owner) ?? new Set<string>(); used.add(plan.id); this.usedPlans.set(owner, used);
    clearTimeout(intent.timer); this.intents.delete(owner);
    let accept!: () => void, reject!: (error: unknown) => void;
    const accepted = new Promise<void>((resolve, no) => { accept = resolve; reject = no; });
    const run: Run = { owner, conversationId: plan.conversationId, requestId: plan.requestId, runId: randomUUID(),
      controller: intent.controller, phase: 'preparing', accepted: false, pendingText: '', checkpointing: false, accept, reject };
    this.active = run; // Reserve before any asynchronous provider/storage wait.
    run.totalTimer = setTimeout(() => run.controller.abort(new ChatError('TIMEOUT')), CHAT_LIMITS.totalMs);
    void this.execute(run, plan, intent.text);
    return accepted.then(() => ({ requestId: run.requestId, runId: run.runId }));
  }
  private event(run: Run, payload: ChatEventPayload): void {
    const sub = this.subscriptions.get(run.owner);
    if (!sub || sub.conversationId !== run.conversationId || this.closed.has(run.owner)) return;
    const event = { ...payload, sessionId: this.sessionId, subscriptionId: sub.id, conversationId: run.conversationId,
      requestId: run.requestId, runId: run.runId, seq: run.message!.seq, revision: this.conversation(run.conversationId).revision } as ChatEvent;
    try { sub.emit(structuredClone(event)); } catch { this.closeOwner(run.owner); }
  }
  private flush(run: Run): void {
    clearTimeout(run.deltaTimer); delete run.deltaTimer;
    if (!run.pendingText || !run.message || run.phase === 'committing') return;
    const text = run.pendingText; run.pendingText = ''; run.message.seq++;
    this.event(run, { type: 'delta', text });
  }
  private checkpoint(run: Run): void {
    if (run.checkpointing || run.phase === 'committing' || run.controller.signal.aborted) return;
    run.checkpointing = true;
    void this.serial(async () => {
      if (this.active !== run || run.phase === 'committing' || run.controller.signal.aborted) return;
      this.flush(run);
      const c = structuredClone(this.conversation(run.conversationId));
      c.messages[c.messages.length - 1] = structuredClone(run.message!); c.revision++; c.updatedAt = now();
      await this.publish(c);
    }).catch((error: unknown) => { const code = persistenceCode(error); this.persistenceFailed.set(run.conversationId, code); run.controller.abort(new ChatError(code)); })
      .finally(() => { run.checkpointing = false; });
  }
  private async execute(run: Run, plan: SendPlan, text: string): Promise<void> {
    let finish: ChatMessage['finishReason'], error: ChatErrorCode | undefined;
    try {
      finish = await this.providers.withSelectedChatAccess({ id: plan.recipient.providerId, expectedRevision: plan.recipient.revision }, run.controller.signal,
        async (profile, key, signal) => {
          const messages = await this.serial(async () => {
            checkSignal(signal); this.subscription(run.owner, this.subscriptions.get(run.owner)?.id ?? '', plan.conversationId);
            if (Date.now() >= plan.expiresAt) throw new ChatError('PLAN_EXPIRED');
            const c = structuredClone(this.conversation(plan.conversationId, plan.conversationRevision));
            const messages = this.context(c, text);
            if (digest(messages) !== plan.disclosure.digest || !equalRecipient(recipient(profile), plan.recipient)) throw new ChatError('CONFLICT');
            if (messages.some((m) => m.content.includes(key))) throw new ChatError('INVALID_INPUT');
            const common = { requestId: run.requestId, runId: run.runId, recipient: plan.recipient, createdAt: now(), updatedAt: now() };
            const user: ChatMessage = { ...common, id: randomUUID(), role: 'user', text, status: 'completed', seq: 0 };
            const assistant: ChatMessage = { ...common, id: randomUUID(), role: 'assistant', text: '', status: 'pending', seq: 1 };
            c.messages.push(user, assistant); c.lastRecipient = plan.recipient; c.revision++; c.updatedAt = assistant.updatedAt;
            if (c.messages.length === 2) c.title = Array.from(text.trim()).slice(0, 30).join('');
            await this.publish(c);
            run.message = structuredClone(assistant); run.accepted = true;
            this.event(run, { type: 'started', user, message: assistant, title: c.title }); run.accept();
            return messages;
          });
          checkSignal(signal);
          if (Date.now() >= plan.expiresAt) throw new ChatError('PLAN_EXPIRED');
          run.checkpoint = setInterval(() => this.checkpoint(run), 1000);
          run.waitTimer = setTimeout(() => {
            if (run.message && !run.message.text && run.phase !== 'committing' && !signal.aborted) {
              run.message.seq++; this.event(run, { type: 'waiting' });
            }
          }, CHAT_LIMITS.visibleWaitMs);
          return this.adapter.stream(plan.recipient, key, messages, signal, (chunk) => {
            checkSignal(signal);
            if (this.active !== run || run.phase === 'committing') throw new ChatError('CANCELLED');
            if (Buffer.byteLength(run.message!.text) + Buffer.byteLength(chunk) > CHAT_LIMITS.outputBytes) throw new ChatError('RESPONSE_TOO_LARGE');
            run.phase = 'streaming'; run.message!.text += chunk; run.message!.status = 'streaming'; run.message!.updatedAt = now();
            run.pendingText += chunk;
            run.deltaTimer ??= setTimeout(() => this.flush(run), 50);
          });
        });
      checkSignal(run.controller.signal);
      if (finish === 'stop' && !run.message?.text.trim()) error = 'EMPTY_RESPONSE';
      if (finish === 'length') error = 'OUTPUT_TRUNCATED';
      if (finish === 'content_filter') error = 'CONTENT_FILTERED';
    } catch (caught) {
      try { checkSignal(run.controller.signal); error = chatCode(caught); } catch (reason) { error = chatCode(reason); }
    }
    try {
      if (!run.accepted) { run.reject(new ChatError(error ?? 'STORE_FAILED')); return; }
      this.flush(run);
      // Single terminal decision, before any await in the final commit.
      run.phase = 'committing'; this.clearTimers(run);
      const message = { ...run.message!, status: error === 'CANCELLED' ? 'stopped' : error ? 'failed' : 'completed',
        updatedAt: now(), seq: run.message!.seq + 1, ...(finish ? { finishReason: finish } : {}), ...(error ? { errorCode: error } : {}) } as ChatMessage;
      let persisted = true;
      try {
        await this.serial(async () => {
          const c = structuredClone(this.conversation(run.conversationId));
          c.messages[c.messages.length - 1] = structuredClone(message); c.revision++; c.updatedAt = message.updatedAt; await this.publish(c);
          this.persistenceFailed.delete(c.id); this.unsaved.delete(c.id);
        });
      } catch (error) {
        const code = persistenceCode(error);
        persisted = false; message.status = 'failed'; message.errorCode = code; delete message.finishReason;
        this.persistenceFailed.set(run.conversationId, code); this.unsaved.set(run.conversationId, structuredClone(message));
      }
      // Do not expose the terminal sequence in snapshots before the commit ends.
      run.message = message;
      this.event(run, { type: message.status as 'completed' | 'failed' | 'stopped', message, persisted });
    } finally {
      this.clearTimers(run); if (this.active === run) this.active = undefined;
    }
  }
  private clearTimers(run: Run): void {
    clearTimeout(run.deltaTimer); clearTimeout(run.waitTimer); clearTimeout(run.totalTimer); clearInterval(run.checkpoint);
  }
}
