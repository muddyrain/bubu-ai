import { randomUUID } from 'node:crypto';
import { PROBE_VERSION } from '../../shared/providers';
import type { CancelProbeOutcome, ProfileTarget, ProbeInput, ProviderErrorCode, ProviderProfile, ProviderSnapshot, SaveProviderInput } from '../../shared/providers';
import type { CredentialVault } from './credential-vault';
import { errorCode, ProviderError } from './errors';
import type { OpenAIChatCompletionsAdapter } from './openai-chat-completions';
import type { ProfileStorage } from './profile-store';
import { abortable, normalizeBaseUrl } from './provider-transport';
import { probeSchema, saveSchema } from './schemas';
import type { ProfileStoreData, StoredProfile } from './schemas';

interface Probe { owner: object; profileId: string; revision: number; controller: AbortController; phase: 'cancellable' | 'committing' }

export class ProviderService {
  private data: ProfileStoreData | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private probes = new Map<string, Probe>();
  private probeSlots = 0;
  private closedOwners = new WeakSet<object>();
  private seenRequests = new WeakMap<object, Set<string>>();
  private cleanupPending = false;
  constructor(private readonly storage: ProfileStorage, private readonly vault: CredentialVault,
    private readonly adapter: Pick<OpenAIChatCompletionsAdapter, 'probe'>) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      if (!this.data) {
        this.data = await this.storage.load();
        await this.collect();
      }
      return operation();
    });
    this.tail = pending.catch(() => {});
    return pending;
  }
  private snapshot(): ProviderSnapshot {
    return { profiles: this.data!.profiles.map((p): ProviderProfile => ({
      id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, modelId: p.modelId,
      enabled: p.enabled, revision: p.revision, createdAt: p.createdAt, updatedAt: p.updatedAt,
      hasKey: Boolean(p.credentialRef),
      ...(p.connection ? { connection: { ...p.connection } } : {}), ...(p.tools ? { tools: { ...p.tools } } : {}),
    })), selectedProfileId: this.data!.selectedProfileId, cleanupPending: this.cleanupPending };
  }
  private async collect(): Promise<void> {
    const live = new Set(this.data!.profiles.flatMap((p) => p.credentialRef ? [p.credentialRef] : []));
    try { this.cleanupPending = !await this.storage.collectCredentials(live); }
    catch { this.cleanupPending = true; }
  }
  private async publish(next: ProfileStoreData): Promise<void> {
    await this.storage.commit(next);
    this.data = next;
    await this.collect();
  }
  private profile(id: string, revision: number): StoredProfile {
    const p = this.data!.profiles.find((item) => item.id === id);
    if (!p) throw new ProviderError('NOT_FOUND');
    if (p.revision !== revision) throw new ProviderError('CONFLICT');
    return p;
  }
  private invalidate(id: string): void {
    for (const p of this.probes.values()) if (p.profileId === id && p.phase === 'cancellable') p.controller.abort();
  }
  list(): Promise<ProviderSnapshot> { return this.serial(async () => this.snapshot()); }
  save(input: SaveProviderInput): Promise<ProviderSnapshot> {
    return this.serial(async () => {
      const parsed = saveSchema.safeParse(input);
      if (!parsed.success) throw new ProviderError('INVALID_INPUT');
      const value = parsed.data;
      const old = value.id ? this.profile(value.id, value.expectedRevision!) : undefined;
      if (old && old.revision >= Number.MAX_SAFE_INTEGER) throw new ProviderError('LIMIT_REACHED');
      if (!old && this.data!.profiles.length >= 20) throw new ProviderError('LIMIT_REACHED');
      const baseUrl = normalizeBaseUrl(value.baseUrl);
      if ((!old || baseUrl !== old.baseUrl) && value.key.action !== 'replace') throw new ProviderError('KEY_REQUIRED');
      if (value.key.action === 'replace' && (value.name.includes(value.key.value) || value.modelId.includes(value.key.value) || baseUrl.includes(value.key.value))) {
        throw new ProviderError('INVALID_INPUT');
      }
      if (old) this.invalidate(old.id);
      let ref = old?.credentialRef ?? null;
      if (value.key.action === 'replace') {
        const ciphertext = await this.vault.encrypt(value.key.value);
        ref = randomUUID();
        await this.storage.putCredential(ref, ciphertext);
      } else if (value.key.action === 'remove') ref = null;
      else if (ref) {
        // A retained key must still be usable; rotated OS keys are rewrapped in the same transaction.
        const retained = await this.vault.decrypt(await this.storage.readCredential(ref));
        if (retained.rotated) { ref = randomUUID(); await this.storage.putCredential(ref, retained.rotated); }
      }
      const now = new Date().toISOString();
      const profile: StoredProfile = { id: old?.id ?? randomUUID(), name: value.name, protocol: value.protocol,
        baseUrl, modelId: value.modelId, enabled: value.enabled && Boolean(ref), revision: (old?.revision ?? 0) + 1,
        createdAt: old?.createdAt ?? now, updatedAt: now, credentialRef: ref };
      const next = structuredClone(this.data!);
      next.profiles = [...next.profiles.filter((p) => p.id !== profile.id), profile];
      if (next.selectedProfileId === profile.id) next.selectedProfileId = null;
      try { await this.publish(next); }
      catch (error) { await this.collect(); throw error; }
      return this.snapshot();
    });
  }
  select(input: ProfileTarget): Promise<ProviderSnapshot> {
    return this.serial(async () => {
      const p = this.profile(input.id, input.expectedRevision);
      if (!p.enabled || !p.credentialRef || p.connection?.outcome !== 'passed') throw new ProviderError('NOT_READY');
      const next = structuredClone(this.data!);
      next.selectedProfileId = p.id;
      await this.publish(next);
      return this.snapshot();
    });
  }
  remove(input: ProfileTarget): Promise<ProviderSnapshot> {
    return this.serial(async () => {
      this.profile(input.id, input.expectedRevision);
      this.invalidate(input.id);
      const next = structuredClone(this.data!);
      next.profiles = next.profiles.filter((p) => p.id !== input.id);
      if (next.selectedProfileId === input.id) next.selectedProfileId = null;
      await this.publish(next);
      return this.snapshot();
    });
  }
  cancel(owner: object, requestId: string): CancelProbeOutcome {
    const probe = this.probes.get(requestId);
    if (!probe || probe.owner !== owner) return { status: 'not-running' };
    if (probe.phase === 'committing') return { status: 'committing' };
    if (probe.controller.signal.aborted) return { status: 'not-running' };
    probe.controller.abort();
    return { status: 'cancelled' };
  }
  closeOwner(owner: object): void {
    this.closedOwners.add(owner);
    for (const probe of this.probes.values()) if (probe.owner === owner && probe.phase === 'cancellable') probe.controller.abort();
  }
  private assertActive(input: ProbeInput, probe: Probe): StoredProfile {
    if (probe.controller.signal.aborted || this.closedOwners.has(probe.owner) || this.probes.get(input.requestId) !== probe) {
      throw new ProviderError(probe.controller.signal.reason instanceof Error && probe.controller.signal.reason.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED');
    }
    return this.profile(input.id, input.revision);
  }
  async probe(owner: object, input: ProbeInput, kind: 'connection' | 'tools'): Promise<ProviderSnapshot> {
    const parsed = probeSchema.safeParse(input);
    if (!parsed.success) throw new ProviderError('INVALID_INPUT');
    input = parsed.data;
    if (this.closedOwners.has(owner)) throw new ProviderError('CANCELLED');
    const seen = this.seenRequests.get(owner) ?? new Set<string>();
    if (seen.has(input.requestId) || seen.size >= 200 || this.probes.has(input.requestId)) throw new ProviderError('LIMIT_REACHED');
    if (this.probeSlots >= 2 || [...this.probes.values()].some((running) => running.profileId === input.id)) throw new ProviderError('BUSY');
    seen.add(input.requestId); this.seenRequests.set(owner, seen);
    // Reserve identity and capacity synchronously, before any initialization/queue wait.
    const probe: Probe = { owner, profileId: input.id, revision: input.revision, controller: new AbortController(), phase: 'cancellable' };
    this.probes.set(input.requestId, probe);
    this.probeSlots++;
    const timer = setTimeout(() => probe.controller.abort(new DOMException('Timed out', 'TimeoutError')), 30_000);
    const starting = this.serial(async () => {
      const p = this.assertActive(input, probe);
      if (input.consent.origin !== new URL(p.baseUrl).origin) throw new ProviderError('INVALID_INPUT');
      if (!p.enabled || !p.credentialRef) throw new ProviderError('KEY_REQUIRED');
    });
    try {
      await abortable(starting, probe.controller.signal);
      let outcome: 'passed' | 'failed' | 'supported' | 'unsupported' | 'unknown';
      let code: ProviderErrorCode | undefined;
      try {
        const profile = await this.serial(async () => this.assertActive(input, probe));
        const decrypted = await abortable(this.vault.decrypt(await this.storage.readCredential(profile.credentialRef!)), probe.controller.signal);
        await this.serial(async () => {
          this.assertActive(input, probe);
          if (decrypted.rotated) {
            const ref = randomUUID();
            await this.storage.putCredential(ref, decrypted.rotated);
            this.assertActive(input, probe);
            const next = structuredClone(this.data!);
            next.profiles.find((p) => p.id === input.id)!.credentialRef = ref;
            await this.publish(next);
          }
        });
        this.assertActive(input, probe);
        outcome = await abortable(this.adapter.probe(profile, decrypted.key, kind, probe.controller.signal), probe.controller.signal);
      } catch (error) {
        code = errorCode(error, 'NETWORK_FAILED');
        if (code === 'CANCELLED' || code === 'CONFLICT' || code === 'NOT_FOUND') throw error;
        outcome = kind === 'connection' ? 'failed' : 'unknown';
      }
      return await this.serial(async () => {
        this.assertActive(input, probe);
        const next = structuredClone(this.data!);
        const profile = next.profiles.find((p) => p.id === input.id)!;
        const evidence: NonNullable<StoredProfile['connection']> = { profileId: input.id, revision: input.revision, requestId: input.requestId,
          probeVersion: PROBE_VERSION, checkedAt: new Date().toISOString(), outcome, ...(code ? { code } : {}) };
        if (kind === 'connection') {
          profile.connection = evidence;
          if (outcome !== 'passed' && next.selectedProfileId === input.id) next.selectedProfileId = null;
        } else profile.tools = evidence;
        // Linearization point: no await separates the active check above from this
        // transition. Cancellation/owner closure can no longer undo this commit.
        probe.phase = 'committing';
        clearTimeout(timer);
        await this.publish(next);
        return this.snapshot();
      });
    } finally {
      clearTimeout(timer);
      if (this.probes.get(input.requestId) === probe) this.probes.delete(input.requestId);
      // Keep capacity until a cancelled start has actually left the serial queue.
      // Otherwise repeated enqueue/cancel could accumulate unlimited queued jobs.
      void starting.then(() => { this.probeSlots--; }, () => { this.probeSlots--; });
    }
  }
}
