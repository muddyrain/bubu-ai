import type { ProviderErrorCode, ProviderResult } from '../../shared/providers';

export function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) { super(code); }
}
export function errorCode(error: unknown, fallback: ProviderErrorCode = 'STORE_FAILED'): ProviderErrorCode {
  return error instanceof ProviderError ? error.code : fallback;
}
export async function safeResult<T>(operation: () => Promise<T>): Promise<ProviderResult<T>> {
  try { return { ok: true, value: await operation() }; }
  catch (error) { return { ok: false, error: { code: errorCode(error) } }; }
}
