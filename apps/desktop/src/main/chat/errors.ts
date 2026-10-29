import { CHAT_ERROR_CODES } from '../../shared/chat';
import type { ChatErrorCode, ChatResult } from '../../shared/chat';
import { ProviderError } from '../providers/errors';

export class ChatError extends Error { constructor(readonly code: ChatErrorCode) { super(code); } }
export const persistenceCode = (error: unknown): 'LIMIT_REACHED' | 'STORE_FAILED' =>
  error instanceof ChatError && error.code === 'LIMIT_REACHED' ? 'LIMIT_REACHED' : 'STORE_FAILED';
export const hasUnsafeControls = (text: string): boolean => Array.from(text).some((char) => {
  const code = char.codePointAt(0)!;
  return code === 127 || code < 32 && code !== 9 && code !== 10 && code !== 13;
});
export function chatCode(error: unknown, fallback: ChatErrorCode = 'NETWORK_FAILED'): ChatErrorCode {
  if (error instanceof ChatError) return error.code;
  if (error instanceof ProviderError && ['CONFLICT','NOT_FOUND'].includes(error.code)) return 'PROVIDER_CHANGED';
  if (error instanceof ProviderError && (CHAT_ERROR_CODES as readonly string[]).includes(error.code)) return error.code as ChatErrorCode;
  return fallback;
}
export function checkSignal(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof ChatError ? signal.reason :
    new ChatError(signal.reason instanceof ProviderError ? 'PROVIDER_CHANGED' : 'CANCELLED');
}
export async function safeChat<T>(operation: () => Promise<T>): Promise<ChatResult<T>> {
  try { return { ok: true, value: await operation() }; } catch (error) { return { ok: false, error: { code: chatCode(error) } }; }
}
