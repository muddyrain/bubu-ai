export const PROVIDER_CHANNELS = {
  list: 'bubu:providers:list', save: 'bubu:providers:save', select: 'bubu:providers:select',
  remove: 'bubu:providers:remove', testConnection: 'bubu:providers:test-connection',
  detectTools: 'bubu:providers:detect-tools', cancelProbe: 'bubu:providers:cancel-probe',
} as const;

export const PROBE_VERSION = 1;
export const CONNECTION_MESSAGE = 'Reply with OK. This is a connection test.';
export const TOOL_MESSAGE = 'Call bubu_capability_probe with the supplied nonce. No tool will be executed.';

export type ProviderErrorCode = 'INVALID_INPUT' | 'UNTRUSTED_SENDER' | 'STORAGE_UNAVAILABLE' |
  'CREDENTIAL_UNAVAILABLE' | 'STORE_FAILED' | 'STORE_CORRUPT' | 'CONFLICT' | 'NOT_FOUND' |
  'KEY_REQUIRED' | 'NOT_READY' | 'LIMIT_REACHED' | 'URL_BLOCKED' | 'DNS_BLOCKED' | 'DNS_FAILED' |
  'REDIRECT_BLOCKED' | 'AUTH_FAILED' | 'MODEL_NOT_FOUND' | 'RATE_LIMITED' | 'TLS_FAILED' |
  'TIMEOUT' | 'CANCELLED' | 'BUSY' | 'RESPONSE_TOO_LARGE' | 'PROTOCOL_ERROR' | 'NETWORK_FAILED';
export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: { code: ProviderErrorCode } };

export interface ProbeEvidence {
  profileId: string;
  revision: number;
  requestId: string;
  probeVersion: number;
  checkedAt: string;
  outcome: 'passed' | 'failed' | 'supported' | 'unsupported' | 'unknown';
  code?: ProviderErrorCode | undefined;
}
export interface ProviderProfile {
  id: string;
  name: string;
  protocol: 'openai-compatible-chat-completions';
  baseUrl: string;
  modelId: string;
  enabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  hasKey: boolean;
  connection?: ProbeEvidence;
  tools?: ProbeEvidence;
}
export interface ProviderSnapshot { profiles: ProviderProfile[]; selectedProfileId: string | null; cleanupPending: boolean }
export interface SaveProviderInput {
  id?: string | undefined;
  expectedRevision?: number | undefined;
  name: string;
  protocol: 'openai-compatible-chat-completions';
  baseUrl: string;
  modelId: string;
  enabled: boolean;
  key: { action: 'keep' | 'remove' } | { action: 'replace'; value: string };
}
export interface ProfileTarget { id: string; expectedRevision: number }
export interface ProbeInput {
  id: string; revision: number; requestId: string;
  consent: { origin: string; accepted: true };
}
export interface CancelProbeOutcome { status: 'cancelled' | 'committing' | 'not-running' }
export interface ProvidersApi {
  list(): Promise<ProviderResult<ProviderSnapshot>>;
  save(input: SaveProviderInput): Promise<ProviderResult<ProviderSnapshot>>;
  select(input: ProfileTarget): Promise<ProviderResult<ProviderSnapshot>>;
  remove(input: ProfileTarget): Promise<ProviderResult<ProviderSnapshot>>;
  testConnection(input: ProbeInput): Promise<ProviderResult<ProviderSnapshot>>;
  detectTools(input: ProbeInput): Promise<ProviderResult<ProviderSnapshot>>;
  cancelProbe(input: { requestId: string }): Promise<ProviderResult<CancelProbeOutcome>>;
}
