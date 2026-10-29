import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CHAT_LIMITS } from '../../shared/chat';
import type { Conversation } from '../../shared/chat';
import { ChatError } from './errors';
import { uuid, validateConversation } from './schemas';

export interface ConversationStorage {
  load(): Promise<Conversation[]>;
  commit(conversation: Conversation): Promise<void>;
  remove(id: string): Promise<void>;
}
const filePattern = /^([0-9a-f-]{36})\.json$/;
const temporaryPattern = /^[0-9a-f-]{36}\.json\.[0-9a-f-]{36}\.tmp$/;

export class FileConversationStore implements ConversationStorage {
  private sizes = new Map<string, number>();
  private loaded = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work); this.tail = result.catch(() => {}); return result;
  }
  private path(id: string): string {
    if (!uuid.safeParse(id).success) throw new ChatError('INVALID_INPUT');
    return join(this.root, `${id}.json`);
  }
  private async directories(create: boolean): Promise<boolean> {
    for (const directory of [dirname(this.root), this.root]) {
      try {
        if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new ChatError('STORE_CORRUPT');
      } catch (error) {
        if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }
    return true;
  }
  private async read(id: string): Promise<Buffer> {
    const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > CHAT_LIMITS.conversationBytes || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new ChatError('STORE_CORRUPT');
      const buffer = Buffer.alloc(CHAT_LIMITS.conversationBytes + 1); let size = 0;
      while (size < buffer.length) {
        const part = await handle.read(buffer, size, buffer.length - size, null);
        if (!part.bytesRead) break;
        size += part.bytesRead;
      }
      if (size > CHAT_LIMITS.conversationBytes) throw new ChatError('STORE_CORRUPT');
      return buffer.subarray(0, size);
    } finally { await handle.close(); }
  }
  load(): Promise<Conversation[]> {
    return this.serial(async () => {
      try {
        if (!await this.directories(false)) { this.sizes.clear(); this.loaded = true; return []; }
        const names = await readdir(this.root);
        if (names.length > CHAT_LIMITS.conversations * 2) throw new ChatError('STORE_CORRUPT');
        const sizes = new Map<string, number>(); const conversations: Conversation[] = [];
        let bytes = 0; const requests = new Set<string>(), runs = new Set<string>();
        for (const name of names) {
          if (temporaryPattern.test(name)) continue; // Never treat an incomplete atomic write as a conversation.
          const id = filePattern.exec(name)?.[1];
          if (!id || !uuid.safeParse(id).success || sizes.size >= CHAT_LIMITS.conversations) throw new ChatError('STORE_CORRUPT');
          const raw = await this.read(id); bytes += raw.length;
          if (bytes > CHAT_LIMITS.totalBytes) throw new ChatError('STORE_CORRUPT');
          const conversation = validateConversation(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
          if (conversation.id !== id) throw new ChatError('STORE_CORRUPT');
          for (const message of conversation.messages.filter((m) => m.role === 'user')) {
            if (requests.has(message.requestId) || runs.has(message.runId)) throw new ChatError('STORE_CORRUPT');
            requests.add(message.requestId); runs.add(message.runId);
          }
          sizes.set(id, raw.length); conversations.push(conversation);
        }
        this.sizes = sizes; this.loaded = true; return conversations;
      } catch { throw new ChatError('STORE_CORRUPT'); }
    });
  }
  commit(conversation: Conversation): Promise<void> {
    return this.serial(async () => {
      if (!this.loaded) throw new ChatError('STORE_FAILED');
      let raw: string;
      try { raw = JSON.stringify(validateConversation(conversation)); } catch { throw new ChatError('STORE_FAILED'); }
      const bytes = Buffer.byteLength(raw);
      if (bytes > CHAT_LIMITS.conversationBytes || (!this.sizes.has(conversation.id) && this.sizes.size >= CHAT_LIMITS.conversations) ||
        [...this.sizes.values()].reduce((a, b) => a + b, 0) - (this.sizes.get(conversation.id) ?? 0) + bytes > CHAT_LIMITS.totalBytes) throw new ChatError('LIMIT_REACHED');
      const path = this.path(conversation.id), temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await this.directories(true);
        // Refuse an unexpected target, including a replaced symlink; do not follow it.
        try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new ChatError('STORE_FAILED'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(raw); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, path);
        this.sizes.set(conversation.id, bytes);
      } catch { throw new ChatError('STORE_FAILED'); }
      finally { await unlink(temporary).catch(() => {}); }
    });
  }
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      if (!this.loaded || !this.sizes.has(id)) throw new ChatError('NOT_FOUND');
      try {
        await this.directories(false);
        const path = this.path(id), stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new ChatError('STORE_FAILED');
        await unlink(path); this.sizes.delete(id);
      } catch { throw new ChatError('STORE_FAILED'); }
    });
  }
}
