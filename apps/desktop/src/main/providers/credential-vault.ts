import { hasControlCharacters, ProviderError } from './errors';

export interface SafeStorageBackend {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
  getSelectedStorageBackend(): string;
}

export class CredentialVault {
  constructor(private readonly backend: SafeStorageBackend, private readonly platform: NodeJS.Platform) {}
  private async timed<T>(operation: () => Promise<T>, code: 'STORAGE_UNAVAILABLE' | 'CREDENTIAL_UNAVAILABLE'): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderError(code)), 10_000);
      })]);
    } catch { throw new ProviderError(code); }
    finally { clearTimeout(timer); }
  }
  private async available(): Promise<void> {
    await this.timed(async () => {
      // Linux's async availability alone does not prove an OS-backed secret service.
      // It remains unsupported until this API can reliably attest the async provider.
      if (this.platform === 'linux' || !['darwin','win32'].includes(this.platform) ||
        !await this.backend.isAsyncEncryptionAvailable()) throw new ProviderError('STORAGE_UNAVAILABLE');
    }, 'STORAGE_UNAVAILABLE');
  }
  async encrypt(key: string): Promise<Buffer> {
    await this.available();
    return this.timed(async () => {
      const encrypted = await this.backend.encryptStringAsync(key);
      if (!encrypted.length || encrypted.equals(Buffer.from(key))) throw new Error();
      return encrypted;
    }, 'STORAGE_UNAVAILABLE');
  }
  async decrypt(ciphertext: Buffer): Promise<{ key: string; rotated: Buffer | null }> {
    await this.available();
    return this.timed(async () => {
      const value = await this.backend.decryptStringAsync(ciphertext);
      if (!value.result || Buffer.byteLength(value.result, 'utf8') > 8192 || /\s/.test(value.result) || hasControlCharacters(value.result)) throw new Error();
      return { key: value.result, rotated: value.shouldReEncrypt ? await this.encrypt(value.result) : null };
    }, 'CREDENTIAL_UNAVAILABLE');
  }
}
