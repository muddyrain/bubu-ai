import { vi } from 'vitest';
import { emptyStore } from './profile-store';
import type { ProfileStorage } from './profile-store';
import type { ProfileStoreData } from './schemas';

export class MemoryStorage implements ProfileStorage {
  data = emptyStore();
  blobs = new Map<string, Buffer>();
  failCommit = false;
  failBlob = false;
  failCleanup = false;
  load = vi.fn(async () => structuredClone(this.data));
  commit = vi.fn(async (value: ProfileStoreData) => {
    if (this.failCommit) throw new Error('private disk detail');
    this.data = structuredClone(value);
  });
  putCredential = vi.fn(async (id: string, data: Buffer) => {
    if (this.failBlob) throw new Error('private disk detail');
    this.blobs.set(id, Buffer.from(data));
  });
  readCredential = vi.fn(async (id: string) => {
    const data = this.blobs.get(id);
    if (!data) throw new Error('private missing credential');
    return Buffer.from(data);
  });
  collectCredentials = vi.fn(async (live: Set<string>) => {
    if (this.failCleanup) return false;
    for (const id of this.blobs.keys()) if (!live.has(id)) this.blobs.delete(id);
    return true;
  });
}
export function mockSafeStorage() {
  // Fixed opaque fixture bytes; these tests never call Electron or any real OS secret store.
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn<(value: string) => Promise<Buffer>>(async () => Buffer.from('opaque-test-ciphertext')),
    decryptStringAsync: vi.fn<(value: Buffer) => Promise<{ result: string; shouldReEncrypt: boolean }>>(async () => ({ result: 'fixture-only-key', shouldReEncrypt: false })),
    getSelectedStorageBackend: vi.fn(() => 'basic_text'),
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
