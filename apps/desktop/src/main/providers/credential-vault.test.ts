import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from './credential-vault';
import { mockSafeStorage } from './test-helpers';

afterEach(() => vi.useRealTimers());
describe('CredentialVault with only a mocked OS backend', () => {
  it.each(['darwin','win32'] as const)('uses only async storage on %s and handles rotation', async (platform) => {
    const backend = mockSafeStorage();
    backend.decryptStringAsync.mockResolvedValue({ result: 'fixture-only-key', shouldReEncrypt: true });
    const vault = new CredentialVault(backend, platform);
    const ciphertext = await vault.encrypt('fixture-only-key');
    expect(ciphertext.toString()).not.toContain('fixture-only-key');
    expect(await vault.decrypt(ciphertext)).toEqual({ key: 'fixture-only-key', rotated: ciphertext });
    expect(backend.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
  it.each(['linux','freebsd'] as const)('fails closed when the secure backend cannot be attested (%s)', async (platform) => {
    const backend = mockSafeStorage();
    await expect(new CredentialVault(backend, platform).encrypt('fixture-only-key')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(backend.encryptStringAsync).not.toHaveBeenCalled();
  });
  it('does not encrypt when availability is false', async () => {
    const backend = mockSafeStorage(); backend.isAsyncEncryptionAvailable.mockResolvedValue(false);
    await expect(new CredentialVault(backend, 'darwin').encrypt('fixture-only-key')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(backend.encryptStringAsync).not.toHaveBeenCalled();
  });
  it.each(['encrypt','decrypt'] as const)('normalizes %s failures without leaking messages', async (operation) => {
    const backend = mockSafeStorage();
    backend.encryptStringAsync.mockRejectedValue(new Error('private fixture-only-key'));
    backend.decryptStringAsync.mockRejectedValue(new Error('temporarily unavailable private fixture-only-key'));
    const vault = new CredentialVault(backend, 'darwin');
    await expect(operation === 'encrypt' ? vault.encrypt('fixture-only-key') : vault.decrypt(Buffer.from('opaque')))
      .rejects.toThrow(operation === 'encrypt' ? 'STORAGE_UNAVAILABLE' : 'CREDENTIAL_UNAVAILABLE');
  });
  it('rejects plaintext and empty ciphertext from a faulty backend', async () => {
    const backend = mockSafeStorage(); const vault = new CredentialVault(backend, 'darwin');
    backend.encryptStringAsync.mockImplementation(async (key) => Buffer.from(key));
    await expect(vault.encrypt('fixture-only-key')).rejects.toThrow('STORAGE_UNAVAILABLE');
    backend.encryptStringAsync.mockResolvedValue(Buffer.alloc(0));
    await expect(vault.encrypt('fixture-only-key')).rejects.toThrow('STORAGE_UNAVAILABLE');
  });
  it('bounds a stalled Keychain operation', async () => {
    vi.useFakeTimers(); const backend = mockSafeStorage();
    backend.isAsyncEncryptionAvailable.mockReturnValue(new Promise(() => {}));
    const result = expect(new CredentialVault(backend, 'darwin').encrypt('fixture-only-key')).rejects.toThrow('STORAGE_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(10_000); await result;
  });
});
