import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ProbeInput, ProviderProfile, SaveProviderInput } from '../../shared/providers';
import { CredentialVault } from './credential-vault';
import { ProviderError, safeResult } from './errors';
import { ProviderService } from './provider-service';
import { deferred, MemoryStorage, mockSafeStorage } from './test-helpers';

const input = (): SaveProviderInput => ({ name: 'Fixture provider', protocol: 'openai-compatible-chat-completions',
  baseUrl: 'https://provider.example/v1', modelId: 'fixture-model', enabled: true,
  key: { action: 'replace', value: 'fixture-only-key' } });
function setup(storage = new MemoryStorage()) {
  const backend = mockSafeStorage();
  const adapter = { probe: vi.fn(async (): Promise<'passed' | 'supported'> => 'passed') };
  const service = new ProviderService(storage, new CredentialVault(backend, 'darwin'), adapter);
  return { service, storage, backend, adapter };
}
async function saved(context: ReturnType<typeof setup>) { return (await context.service.save(input())).profiles[0]!; }
function probe(profile: ProviderProfile): ProbeInput {
  return { id: profile.id, revision: profile.revision, requestId: randomUUID(), consent: { origin: 'https://provider.example', accepted: true } };
}
async function blockUnrelatedSave(c: ReturnType<typeof setup>) {
  const writing = deferred<void>(); const release = deferred<void>();
  c.storage.commit.mockImplementationOnce(async (next) => {
    writing.resolve(); await release.promise; c.storage.data = structuredClone(next);
  });
  const save = c.service.save({ ...input(), name: 'Unrelated profile' });
  await writing.promise;
  return { save, release };
}
describe('ProviderService transactions and snapshots', () => {
  it('stores multiple profiles, restores selection and exposes no credential material', async () => {
    const c = setup(); const p = await saved(c);
    await c.service.save({ ...input(), name: 'Second' });
    await c.service.probe({}, probe(p), 'connection');
    await c.service.select({ id: p.id, expectedRevision: p.revision });
    const restored = await setup(c.storage).service.list();
    expect(restored.profiles).toHaveLength(2); expect(restored.selectedProfileId).toBe(p.id);
    const output = JSON.stringify(restored);
    for (const secret of ['fixture-only-key','opaque-test-ciphertext','credentialRef','.bin']) expect(output).not.toContain(secret);
    expect(JSON.stringify(c.storage.data)).not.toContain('fixture-only-key');
    expect(c.backend.encryptStringAsync).toHaveBeenCalledTimes(2);
    expect(c.adapter.probe).toHaveBeenCalledTimes(1); // Save/list/select never send requests.
  });
  it('requires current verification for selection and fresh keys for a changed Base URL', async () => {
    const c = setup(); const p = await saved(c);
    await expect(c.service.select({ id: p.id, expectedRevision: 1 })).rejects.toThrow('NOT_READY');
    await expect(c.service.save({ ...input(), id: p.id, expectedRevision: 1, baseUrl: 'https://other.example/v1', key: { action: 'keep' } })).rejects.toThrow('KEY_REQUIRED');
    expect(c.backend.decryptStringAsync).not.toHaveBeenCalled();
  });
  it('clears verification and selection on every edit and rejects stale revisions', async () => {
    const c = setup(); const p = await saved(c);
    await c.service.probe({}, probe(p), 'connection');
    await c.service.select({ id: p.id, expectedRevision: 1 });
    const updated = await c.service.save({ ...input(), id: p.id, expectedRevision: 1, key: { action: 'keep' }, name: 'Renamed' });
    expect(updated.selectedProfileId).toBeNull(); expect(updated.profiles[0]?.connection).toBeUndefined();
    expect(updated.profiles[0]?.revision).toBe(2);
    await expect(c.service.remove({ id: p.id, expectedRevision: 1 })).rejects.toThrow('CONFLICT');
  });
  it('preserves old configuration and key if metadata commit fails after a new key is written', async () => {
    const c = setup(); const p = await saved(c); const before = structuredClone(c.storage.data);
    const oldRef = before.profiles[0]!.credentialRef!;
    c.storage.failCommit = true;
    await expect(c.service.save({ ...input(), id: p.id, expectedRevision: 1 })).rejects.toThrow();
    expect(c.storage.data).toEqual(before); expect([...c.storage.blobs.keys()]).toEqual([oldRef]);
    expect((await c.service.list()).profiles[0]?.revision).toBe(1);
  });
  it.each(['unavailable','encrypt','blob'] as const)('does not commit failed credential preparation: %s', async (failure) => {
    const c = setup();
    if (failure === 'unavailable') c.backend.isAsyncEncryptionAvailable.mockResolvedValue(false);
    if (failure === 'encrypt') c.backend.encryptStringAsync.mockRejectedValue(new Error('private'));
    if (failure === 'blob') c.storage.failBlob = true;
    expect((await safeResult(() => c.service.save(input()))).ok).toBe(false);
    expect(c.storage.commit).not.toHaveBeenCalled(); expect((await c.service.list()).profiles).toEqual([]);
  });
  it('rotates OS encryption without returning its key, and never references orphan files on restart', async () => {
    const c = setup(); const p = await saved(c); const old = c.storage.data.profiles[0]!.credentialRef;
    c.backend.decryptStringAsync.mockResolvedValue({ result: 'fixture-only-key', shouldReEncrypt: true });
    await c.service.probe({}, probe(p), 'connection');
    expect(c.storage.data.profiles[0]!.credentialRef).not.toBe(old);
    expect(c.storage.blobs.has(old!)).toBe(false);
    c.storage.blobs.set(randomUUID(), Buffer.from('orphan'));
    await setup(c.storage).service.list(); expect(c.storage.blobs.size).toBe(1);
  });
  it('removes keys and selection, reports cleanup failure and retries cleanup on restart', async () => {
    const c = setup(); const p = await saved(c);
    c.storage.failCleanup = true;
    const result = await c.service.remove({ id: p.id, expectedRevision: 1 });
    expect(result).toMatchObject({ profiles: [], selectedProfileId: null, cleanupPending: true });
    await expect(c.service.probe({}, probe(p), 'connection')).rejects.toThrow('NOT_FOUND');
    c.storage.failCleanup = false;
    expect((await setup(c.storage).service.list()).cleanupPending).toBe(false); expect(c.storage.blobs.size).toBe(0);
  });
  it('removing a key disables the profile and prevents use of the old key', async () => {
    const c = setup(); const p = await saved(c);
    const result = await c.service.save({ ...input(), id: p.id, expectedRevision: 1, key: { action: 'remove' } });
    expect(result.profiles[0]).toMatchObject({ hasKey: false, enabled: false }); expect(c.storage.blobs.size).toBe(0);
    await expect(c.service.probe({}, probe(result.profiles[0]!), 'connection')).rejects.toThrow('KEY_REQUIRED');
  });
  it('keeps connection and tool outcomes independent, with bound evidence', async () => {
    const c = setup(); const p = await saved(c); const args = probe(p);
    await c.service.probe({}, args, 'connection');
    c.adapter.probe.mockRejectedValueOnce(new ProviderError('AUTH_FAILED'));
    const result = await c.service.probe({}, probe(p), 'tools');
    expect(result.profiles[0]!.connection).toMatchObject({ profileId: p.id, revision: args.revision, requestId: args.requestId, outcome: 'passed' });
    expect(result.profiles[0]!.tools).toMatchObject({ outcome: 'unknown', code: 'AUTH_FAILED', revision: 1, probeVersion: 1, profileId: p.id });
  });
});
describe('probe cancellation, ownership and late results', () => {
  it('cancels a queued probe before registration and never sends a model request', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const { save, release } = await blockUnrelatedSave(c);
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    const cancellation = c.service.cancel(owner, args.requestId);
    const returned = await result; // Cancellation finishes even while storage remains blocked.
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'not-running' });
    release.resolve(); await save;
    await c.service.list(); // The cancelled initialization has now left the queue.
    expect(c.adapter.probe).not.toHaveBeenCalled();
    expect(cancellation).toEqual({ status: 'cancelled' });
    expect(returned).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect(c.storage.data.profiles.find((profile) => profile.id === p.id)?.connection).toBeUndefined();
    expect(c.backend.decryptStringAsync).not.toHaveBeenCalled();
    expect(c.storage.commit).toHaveBeenCalledTimes(2);
    await expect(c.service.probe(owner, args, 'connection')).rejects.toThrow('LIMIT_REACHED');
    await c.service.probe(owner, probe(p), 'connection');
    expect(c.adapter.probe).toHaveBeenCalledOnce(); // Only the explicitly requested fresh probe.
  });
  it('cancels during initial metadata loading before any credential or model access', async () => {
    const existing = setup(); const p = await saved(existing); const c = setup(existing.storage);
    const loading = deferred<void>(); const release = deferred<void>(); const owner = {}; const args = probe(p);
    c.storage.load.mockImplementationOnce(async () => { loading.resolve(); await release.promise; return structuredClone(c.storage.data); });
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    await loading.promise;
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'cancelled' });
    expect(await result).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'not-running' });
    release.resolve(); await c.service.list();
    expect(c.adapter.probe).not.toHaveBeenCalled(); expect(c.backend.decryptStringAsync).not.toHaveBeenCalled();
  });
  it('revokes queued work immediately when its owner closes', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const { save, release } = await blockUnrelatedSave(c);
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    c.service.closeOwner(owner);
    expect(await result).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'not-running' });
    release.resolve(); await save; await c.service.list();
    expect(c.adapter.probe).not.toHaveBeenCalled(); expect(c.backend.decryptStringAsync).not.toHaveBeenCalled();
    expect(c.storage.data.profiles.find((profile) => profile.id === p.id)?.connection).toBeUndefined();
    await expect(c.service.probe(owner, probe(p), 'connection')).rejects.toThrow('CANCELLED');
  });
  it('does not let another owner cancel a queued request', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const { save, release } = await blockUnrelatedSave(c);
    const result = c.service.probe(owner, args, 'connection');
    const cancellation = c.service.cancel({}, args.requestId);
    release.resolve(); await save;
    expect((await result).profiles[0]?.connection).toMatchObject({ requestId: args.requestId, outcome: 'passed' });
    expect(cancellation).toEqual({ status: 'not-running' });
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it.each(['same owner', 'different owner'] as const)('rejects duplicate queued request IDs from %s without replacing the original', async (source) => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const { save, release } = await blockUnrelatedSave(c);
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    await expect(c.service.probe(source === 'same owner' ? owner : {}, args, 'tools')).rejects.toThrow('LIMIT_REACHED');
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'cancelled' });
    expect(await result).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    release.resolve(); await save; await c.service.list();
    expect(c.adapter.probe).not.toHaveBeenCalled();
  });
  it('bounds queued work, including cancelled jobs until they leave the queue, and releases capacity afterwards', async () => {
    const c = setup(); const p = await saved(c);
    const second = (await c.service.save({ ...input(), name: 'Second' })).profiles.at(-1)!;
    const third = (await c.service.save({ ...input(), name: 'Third' })).profiles.at(-1)!;
    const { save, release } = await blockUnrelatedSave(c);
    const owner = {}; const firstArgs = probe(p); const secondArgs = probe(second);
    const firstResult = safeResult(() => c.service.probe(owner, firstArgs, 'connection'));
    await expect(c.service.probe(owner, probe(p), 'tools')).rejects.toThrow('BUSY');
    const secondResult = safeResult(() => c.service.probe(owner, secondArgs, 'connection'));
    await expect(c.service.probe(owner, probe(third), 'connection')).rejects.toThrow('BUSY');
    expect(c.service.cancel(owner, firstArgs.requestId)).toEqual({ status: 'cancelled' });
    expect(c.service.cancel(owner, secondArgs.requestId)).toEqual({ status: 'cancelled' });
    expect(await firstResult).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect(await secondResult).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    // New owners cannot bypass the global bound by repeatedly enqueueing and cancelling.
    for (let attempt = 0; attempt < 5; attempt++) await expect(c.service.probe({}, probe(third), 'connection')).rejects.toThrow('BUSY');
    release.resolve(); await save; await c.service.list();
    expect(c.adapter.probe).not.toHaveBeenCalled();
    await c.service.probe({}, probe(third), 'connection');
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it.each(['schema', 'consent', 'revision', 'missing', 'storage'] as const)('cleans up a failed start (%s) and permits a fresh request', async (failure) => {
    const existing = setup(); const p = await saved(existing);
    const c = failure === 'storage' ? setup(existing.storage) : existing;
    const owner = {}; const args = probe(p);
    if (failure === 'schema') Object.assign(args, { unexpected: true });
    if (failure === 'consent') args.consent.origin = 'https://attacker.example';
    if (failure === 'revision') args.revision++;
    if (failure === 'missing') args.id = randomUUID();
    if (failure === 'storage') c.storage.load.mockRejectedValueOnce(new Error('private load failure'));
    const code = { schema: 'INVALID_INPUT', consent: 'INVALID_INPUT', revision: 'CONFLICT', missing: 'NOT_FOUND', storage: 'STORE_FAILED' }[failure];
    expect(await safeResult(() => c.service.probe(owner, args, 'connection'))).toEqual({ ok: false, error: { code } });
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'not-running' });
    expect(c.adapter.probe).not.toHaveBeenCalled();
    await c.service.probe(owner, probe(p), 'connection');
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('revalidates the profile revision after waiting behind an edit commit', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const writing = deferred<void>(); const release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (next) => {
      writing.resolve(); await release.promise; c.storage.data = structuredClone(next);
    });
    const edit = c.service.save({ ...input(), id: p.id, expectedRevision: p.revision, name: 'Renamed' });
    await writing.promise;
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    release.resolve(); await edit;
    expect(await result).toEqual({ ok: false, error: { code: 'CONFLICT' } });
    expect(c.adapter.probe).not.toHaveBeenCalled(); expect(c.storage.data.profiles[0]?.connection).toBeUndefined();
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'not-running' });
  });
  it.each([['connection', 'passed'], ['tools', 'supported']] as const)('reports that final %s commit is no longer cancellable and returns the persisted result', async (kind, outcome) => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const committing = deferred<void>(); const release = deferred<void>();
    c.adapter.probe.mockResolvedValueOnce(outcome);
    c.storage.commit.mockImplementationOnce(async (next) => {
      committing.resolve();
      await release.promise;
      c.storage.data = structuredClone(next);
    });
    const result = c.service.probe(owner, args, kind);
    await committing.promise;
    const cancellation = c.service.cancel(owner, args.requestId);
    release.resolve();
    const returned = await result;
    expect(returned.profiles[0]?.[kind]).toEqual(c.storage.data.profiles[0]?.[kind]);
    expect(returned.profiles[0]?.[kind]).toMatchObject({ requestId: args.requestId, outcome });
    expect(cancellation).toEqual({ status: 'committing' });
    expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'not-running' });
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('cancels credential preparation before any model request can start', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const decrypting = deferred<void>(); const release = deferred<{ result: string; shouldReEncrypt: boolean }>();
    c.backend.decryptStringAsync.mockImplementationOnce(() => { decrypting.resolve(); return release.promise; });
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    await decrypting.promise;
    const cancellation = c.service.cancel(owner, args.requestId);
    release.resolve({ result: 'fixture-only-key', shouldReEncrypt: false });
    expect(await result).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect(cancellation).toEqual({ status: 'cancelled' });
    expect(c.adapter.probe).not.toHaveBeenCalled();
    expect(c.storage.commit).toHaveBeenCalledOnce(); // Only the initial profile save.
    expect(c.storage.data.profiles[0]?.connection).toBeUndefined();
  });
  it('cancels a completed response while final preparation is waiting behind another metadata operation', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const network = deferred<'passed'>(); const requested = deferred<void>(); const responseReady = deferred<void>();
    c.adapter.probe.mockImplementationOnce(async () => {
      requested.resolve(); const value = await network.promise; responseReady.resolve(); return value;
    });
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    await requested.promise;
    const saving = deferred<void>(); const release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (next) => {
      saving.resolve(); await release.promise; c.storage.data = structuredClone(next);
    });
    const otherSave = c.service.save({ ...input(), name: 'Unrelated profile' });
    await saving.promise;
    network.resolve('passed'); await responseReady.promise;
    const cancellation = c.service.cancel(owner, args.requestId);
    release.resolve(); await otherSave;
    expect(await result).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect(cancellation).toEqual({ status: 'cancelled' });
    expect((await c.service.list()).profiles.find((profile) => profile.id === p.id)?.connection).toBeUndefined();
    expect(c.storage.data.profiles.find((profile) => profile.id === p.id)?.connection).toBeUndefined();
    expect(c.storage.commit).toHaveBeenCalledTimes(2); // Initial save and unrelated save, no probe result.
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('finishes an irrevocable commit after owner closure and rejects future requests from that document', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const committing = deferred<void>(); const release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (next) => {
      committing.resolve(); await release.promise; c.storage.data = structuredClone(next);
    });
    const result = c.service.probe(owner, args, 'connection');
    await committing.promise; c.service.closeOwner(owner);
    const cancellation = c.service.cancel(owner, args.requestId);
    release.resolve();
    const returned = await result;
    expect(cancellation).toEqual({ status: 'committing' });
    expect(returned.profiles[0]?.connection).toMatchObject({ requestId: args.requestId, outcome: 'passed' });
    expect(returned).toEqual(await setup(c.storage).service.list());
    await expect(c.service.probe(owner, probe(p), 'connection')).rejects.toThrow('CANCELLED');
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('serializes an edit behind a final commit, then invalidates the old revision without replaying the probe', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const committing = deferred<void>(); const release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (next) => {
      committing.resolve(); await release.promise; c.storage.data = structuredClone(next);
    });
    const result = c.service.probe(owner, args, 'connection');
    await committing.promise;
    const edit = c.service.save({ ...input(), id: p.id, expectedRevision: p.revision, name: 'Renamed', key: { action: 'keep' } });
    const cancellation = c.service.cancel(owner, args.requestId);
    release.resolve();
    const returned = await result; const edited = await edit;
    expect(cancellation).toEqual({ status: 'committing' });
    expect(returned.profiles[0]).toMatchObject({ revision: 1, connection: { requestId: args.requestId, outcome: 'passed' } });
    expect(edited.profiles[0]).toMatchObject({ name: 'Renamed', revision: 2 });
    expect(edited.profiles[0]?.connection).toBeUndefined();
    expect(edited).toEqual(await setup(c.storage).service.list());
    expect(c.storage.data.profiles[0]?.connection).toBeUndefined();
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('reports a failed final commit honestly after cancellation was refused and preserves the prior disk state', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const before = structuredClone(c.storage.data); const committing = deferred<void>(); const release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async () => { committing.resolve(); await release.promise; });
    const result = safeResult(() => c.service.probe(owner, args, 'connection'));
    await committing.promise;
    const cancellation = c.service.cancel(owner, args.requestId);
    release.reject(new Error('private write failure'));
    expect(await result).toEqual({ ok: false, error: { code: 'STORE_FAILED' } });
    expect(cancellation).toEqual({ status: 'committing' });
    expect(c.storage.data).toEqual(before);
    expect(await c.service.list()).toEqual(await setup(c.storage).service.list());
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('does not turn a final commit into a fictitious timeout after the cancellable deadline', async () => {
    const c = setup(); const p = await saved(c); const owner = {}; const args = probe(p);
    const committing = deferred<void>(); const release = deferred<void>();
    c.storage.commit.mockImplementationOnce(async (next) => {
      committing.resolve(); await release.promise; c.storage.data = structuredClone(next);
    });
    vi.useFakeTimers();
    try {
      const result = c.service.probe(owner, args, 'connection');
      await committing.promise; await vi.advanceTimersByTimeAsync(30_001);
      const cancellation = c.service.cancel(owner, args.requestId);
      release.resolve(); const returned = await result;
      expect(cancellation).toEqual({ status: 'committing' });
      expect(returned.profiles[0]?.connection).toEqual(c.storage.data.profiles[0]?.connection);
      expect(returned.profiles[0]?.connection?.outcome).toBe('passed');
      expect(c.adapter.probe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it.each(['cancel','edit','delete','close'] as const)('discards a late success after %s', async (action) => {
    const c = setup(); const p = await saved(c); const pending = deferred<'passed'>(); const entered = deferred<void>();
    c.adapter.probe.mockImplementationOnce(async () => { entered.resolve(); return pending.promise; });
    const owner = {}; const args = probe(p);
    const outcome = safeResult(() => c.service.probe(owner, args, 'connection'));
    await entered.promise;
    if (action === 'cancel') expect(c.service.cancel(owner, args.requestId)).toEqual({ status: 'cancelled' });
    if (action === 'close') c.service.closeOwner(owner);
    if (action === 'delete') await c.service.remove({ id: p.id, expectedRevision: 1 });
    if (action === 'edit') await c.service.save({ ...input(), id: p.id, expectedRevision: 1 });
    pending.resolve('passed');
    expect(await outcome).toEqual({ ok: false, error: { code: 'CANCELLED' } });
    expect((await c.service.list()).profiles[0]?.connection).toBeUndefined();
    expect(c.storage.data.profiles[0]?.connection).toBeUndefined();
    expect(c.adapter.probe).toHaveBeenCalledOnce();
  });
  it('rejects a different receiver, concurrent probes, replayed IDs and a closed owner', async () => {
    const c = setup(); const p = await saved(c); const pending = deferred<'passed'>(); const entered = deferred<void>();
    const owner = {}; const args = probe(p);
    await expect(c.service.probe(owner, { ...probe(p), consent: { origin: 'https://attacker.example', accepted: true } }, 'connection')).rejects.toThrow('INVALID_INPUT');
    c.adapter.probe.mockImplementationOnce(async () => { entered.resolve(); return pending.promise; });
    const first = c.service.probe(owner, args, 'connection'); await entered.promise;
    await expect(c.service.probe(owner, probe(p), 'connection')).rejects.toThrow('BUSY');
    expect(c.service.cancel({}, args.requestId)).toEqual({ status: 'not-running' }); pending.resolve('passed'); await first;
    await expect(c.service.probe(owner, args, 'connection')).rejects.toThrow('LIMIT_REACHED');
    c.service.closeOwner(owner);
    await expect(c.service.probe(owner, probe(p), 'connection')).rejects.toThrow('CANCELLED');
  });
});
