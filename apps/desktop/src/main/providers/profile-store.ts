import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ProviderError } from './errors';
import { normalizeBaseUrl } from './provider-transport';
import { idSchema, storeSchema } from './schemas';
import type { ProfileStoreData } from './schemas';

export interface ProfileStorage {
  load(): Promise<ProfileStoreData>;
  commit(data: ProfileStoreData): Promise<void>;
  putCredential(ref: string, data: Buffer): Promise<void>;
  readCredential(ref: string): Promise<Buffer>;
  collectCredentials(live: Set<string>): Promise<boolean>;
}
export const emptyStore = (): ProfileStoreData => ({ schemaVersion: 1, selectedProfileId: null, profiles: [] });

// No renderer-supplied path enters this class. Only generated/validated UUID references are accepted.
export class FileProfileStorage implements ProfileStorage {
  constructor(private readonly root: string) {}
  private credentialPath(ref: string): string {
    if (!idSchema.safeParse(ref).success) throw new ProviderError('STORE_CORRUPT');
    return join(this.root, 'credentials', `${ref}.bin`);
  }
  private async prepare(): Promise<void> {
    for (const directory of [this.root, join(this.root, 'credentials')]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) throw new ProviderError('STORE_FAILED');
    }
  }
  private async read(path: string, limit: number): Promise<Buffer> {
    for (const directory of [this.root, join(this.root, 'credentials')]) {
      try {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProviderError('STORE_CORRUPT');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > limit) throw new ProviderError('STORE_CORRUPT');
      // Bound reads even if a file grows after stat.
      const buffer = Buffer.alloc(limit + 1);
      let total = 0;
      while (total <= limit) {
        const read = await handle.read(buffer, total, buffer.length - total, null);
        if (!read.bytesRead) return buffer.subarray(0, total);
        total += read.bytesRead;
      }
      throw new ProviderError('STORE_CORRUPT');
    } finally { await handle.close(); }
  }
  private async atomic(path: string, data: string | Buffer): Promise<void> {
    await this.prepare();
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async load(): Promise<ProfileStoreData> {
    let data: Buffer;
    try { data = await this.read(join(this.root, 'profiles.json'), 1_048_576); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore();
      throw new ProviderError('STORE_CORRUPT');
    }
    try {
      const parsed = storeSchema.parse(JSON.parse(data.toString('utf8')));
      const ids = new Set(parsed.profiles.map((p) => p.id));
      const refs = parsed.profiles.flatMap((p) => p.credentialRef ? [p.credentialRef] : []);
      if (ids.size !== parsed.profiles.length || new Set(refs).size !== refs.length ||
        (parsed.selectedProfileId && !ids.has(parsed.selectedProfileId))) throw new Error();
      for (const profile of parsed.profiles) {
        if (normalizeBaseUrl(profile.baseUrl) !== profile.baseUrl) throw new Error();
        for (const evidence of [profile.connection, profile.tools]) {
          if (evidence && (evidence.profileId !== profile.id || evidence.revision !== profile.revision)) throw new Error();
        }
        if (profile.connection && !['passed','failed'].includes(profile.connection.outcome)) throw new Error();
        if (profile.tools && !['supported','unsupported','unknown'].includes(profile.tools.outcome)) throw new Error();
        if (parsed.selectedProfileId === profile.id && (!profile.enabled || !profile.credentialRef || profile.connection?.outcome !== 'passed')) throw new Error();
      }
      return parsed;
    } catch { throw new ProviderError('STORE_CORRUPT'); }
  }
  async commit(data: ProfileStoreData): Promise<void> { await this.atomic(join(this.root, 'profiles.json'), JSON.stringify(data)); }
  async putCredential(ref: string, data: Buffer): Promise<void> { await this.atomic(this.credentialPath(ref), data); }
  async readCredential(ref: string): Promise<Buffer> {
    try { return await this.read(this.credentialPath(ref), 16384); }
    catch { throw new ProviderError('CREDENTIAL_UNAVAILABLE'); }
  }
  async collectCredentials(live: Set<string>): Promise<boolean> {
    try {
      const directory = join(this.root, 'credentials');
      // Never traverse a replaced credentials directory.
      for (const path of [this.root, directory]) {
        const stat = await lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      }
      for (const name of await readdir(directory)) {
        const ref = name.endsWith('.bin') ? name.slice(0, -4) : '';
        if ((idSchema.safeParse(ref).success && !live.has(ref)) || /^[\da-f-]+\.bin\.[\da-f-]+\.tmp$/.test(name)) {
          await unlink(join(directory, name));
        }
      }
      return true;
    } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
  }
}
