import { lookup } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { hasControlCharacters, ProviderError } from './errors';

export function providerEndpoint(raw: string): URL {
  if (raw.length > 2048 || /[\s\\%?#@]/.test(raw) || hasControlCharacters(raw)) throw new ProviderError('URL_BLOCKED');
  let url: URL;
  try { url = new URL(raw); } catch { throw new ProviderError('URL_BLOCKED'); }
  const labels = url.hostname.split('.');
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password ||
    isIP(url.hostname) || labels.length < 2 || /^\d+$/.test(labels.at(-1)!) ||
    labels.some((s) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)) ||
    /\.(?:localhost|local|internal|home|lan)$/.test(url.hostname) ||
    !/^https:\/\/[^/]+(?:\/[a-zA-Z0-9._~-]+)*\/?$/.test(raw) ||
    raw.split('/').some((part) => part === '.' || part === '..')) throw new ProviderError('URL_BLOCKED');
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
  return url;
}
export function normalizeBaseUrl(raw: string): string {
  const endpoint = providerEndpoint(raw);
  return endpoint.href.slice(0, -'/chat/completions'.length);
}
export function publicAddress(address: string): boolean {
  try {
    if (!isIP(address) || address.includes('%')) return false;
    const parsed = ipaddr.parse(address);
    return parsed.range() === 'unicast'; // Includes neither IPv4-mapped IPv6 nor transition/reserved ranges.
  } catch { return false; }
}

export interface TransportResponse { status: number; body: unknown }
export interface ProviderTransport {
  post(baseUrl: string, key: string, body: object, signal: AbortSignal): Promise<TransportResponse>;
}
export interface TransportDependencies {
  resolve: (hostname: string) => Promise<{ address: string; family: number }[]>;
  request: typeof request;
}
function cancelled(signal: AbortSignal): ProviderError {
  return new ProviderError(signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED');
}
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw cancelled(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export class HttpsProviderTransport implements ProviderTransport {
  constructor(private readonly deps: TransportDependencies = {
    resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }), request,
  }) {}

  async post(baseUrl: string, key: string, body: object, outerSignal: AbortSignal): Promise<TransportResponse> {
    const url = providerEndpoint(baseUrl);
    const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(20_000)]);
    if (signal.aborted) throw cancelled(signal);
    let addresses: { address: string; family: number }[];
    try { addresses = await abortable(this.deps.resolve(url.hostname), signal); }
    catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('DNS_FAILED'); }
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address) || isIP(a.address) !== a.family)) {
      throw new ProviderError('DNS_BLOCKED');
    }
    if (signal.aborted) throw cancelled(signal);
    const chosen = addresses[0]!;
    const payload = JSON.stringify(body);
    const agent = new Agent({ keepAlive: false, maxSockets: 1 });
    try {
      return await new Promise<TransportResponse>((resolve, reject) => {
        const req = this.deps.request(url, {
          method: 'POST', agent, signal, rejectUnauthorized: true, servername: url.hostname,
          family: chosen.family, maxHeaderSize: 16_384,
          // Pin this connection to the validated result. No second resolver or proxy is used.
          lookup: (_hostname, _options, callback) => callback(null, chosen.address, chosen.family),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload), 'Accept-Encoding': 'identity' },
        }, (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy(); reject(new ProviderError('REDIRECT_BLOCKED')); return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 131_072) {
              res.destroy(); req.destroy(); reject(new ProviderError('RESPONSE_TOO_LARGE'));
            } else chunks.push(chunk);
          });
          res.on('error', () => reject(signal.aborted ? cancelled(signal) : new ProviderError('NETWORK_FAILED')));
          res.on('aborted', () => reject(new ProviderError('NETWORK_FAILED')));
          res.on('end', () => {
            let data: unknown;
            try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { data = null; }
            resolve({ status, body: data });
          });
        });
        req.on('error', (error: NodeJS.ErrnoException) => {
          if (signal.aborted) reject(cancelled(signal));
          else reject(new ProviderError(/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code ?? '') ? 'TLS_FAILED' : 'NETWORK_FAILED'));
        });
        req.end(payload);
      });
    } finally { agent.destroy(); }
  }
}
