import { lookup } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { CHAT_LIMITS } from '../../shared/chat';
import { abortable, providerEndpoint, publicAddress } from '../providers/provider-transport';
import type { TransportDependencies } from '../providers/provider-transport';
import { ChatError, checkSignal } from './errors';

export interface ChatStreamTransport {
  stream(baseUrl: string, key: string, body: object, signal: AbortSignal, onBytes: (chunk: Buffer) => boolean | void): Promise<void>;
}
// Separate streaming branch; the reviewed non-streaming probe transport is untouched.
export class HttpsChatStreamTransport implements ChatStreamTransport {
  constructor(private readonly deps: TransportDependencies = { resolve: (host) => lookup(host, { all: true, verbatim: true }), request }) {}
  async stream(baseUrl: string, key: string, body: object, outer: AbortSignal, onBytes: (chunk: Buffer) => boolean | void): Promise<void> {
    const url = providerEndpoint(baseUrl);
    const deadline = new AbortController();
    const signal = AbortSignal.any([outer, deadline.signal]);
    const headerTimer = setTimeout(() => deadline.abort(new ChatError('TIMEOUT')), 20_000);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const totalTimer = setTimeout(() => deadline.abort(new ChatError('TIMEOUT')), CHAT_LIMITS.totalMs);
    const agent = new Agent({ keepAlive: false, maxSockets: 1 });
    try {
      checkSignal(signal);
      let addresses: { address: string; family: number }[];
      try { addresses = await abortable(this.deps.resolve(url.hostname), signal); }
      catch { checkSignal(signal); throw new ChatError('DNS_FAILED'); }
      checkSignal(signal);
      if (!addresses.length || addresses.some((a) => !publicAddress(a.address) || isIP(a.address) !== a.family)) throw new ChatError('DNS_BLOCKED');
      const chosen = addresses[0]!;
      const payload = JSON.stringify(body);
      if (Buffer.byteLength(payload) > CHAT_LIMITS.contextBytes + 4096) throw new ChatError('LIMIT_REACHED');
      await new Promise<void>((resolve, reject) => {
        let response: IncomingMessage | undefined, settled = false, bytes = 0;
        const resetIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => deadline.abort(new ChatError('NETWORK_IDLE')), CHAT_LIMITS.idleMs); };
        const finish = (error?: unknown) => {
          if (settled) return; settled = true;
          signal.removeEventListener('abort', abort);
          clearTimeout(idleTimer); clearTimeout(headerTimer);
          response?.destroy(); req.destroy();
          if (error) reject(error); else resolve();
        };
        const abort = () => { try { checkSignal(signal); } catch (error) { finish(error); } };
        const req = this.deps.request(url, { method: 'POST', agent, signal, rejectUnauthorized: true,
          servername: url.hostname, family: chosen.family, maxHeaderSize: 16_384,
          lookup: (_host, _options, callback) => callback(null, chosen.address, chosen.family),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream',
            'Content-Length': Buffer.byteLength(payload), 'Accept-Encoding': 'identity' },
        }, (res) => {
          response = res;
          const status = res.statusCode ?? 0;
          const code = status >= 300 && status < 400 ? 'REDIRECT_BLOCKED' : status === 401 || status === 403 ? 'AUTH_FAILED' :
            status === 404 ? 'MODEL_NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'NETWORK_FAILED' : status !== 200 ? 'PROTOCOL_ERROR' : null;
          if (code) { finish(new ChatError(code)); return; }
          const type = res.headers['content-type'];
          const encoding = res.headers['content-encoding'];
          if (typeof type !== 'string' || !/^text\/event-stream(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(type) || (encoding && encoding !== 'identity')) {
            finish(new ChatError('PROTOCOL_ERROR')); return;
          }
          clearTimeout(headerTimer); resetIdle();
          res.on('data', (chunk: Buffer) => {
            if (settled) return;
            try {
              checkSignal(signal); bytes += chunk.length;
              if (bytes > CHAT_LIMITS.responseBytes) throw new ChatError('RESPONSE_TOO_LARGE');
              resetIdle(); if (onBytes(chunk)) finish();
            } catch (error) { finish(error); }
          });
          res.on('end', () => finish());
          res.on('aborted', () => finish(new ChatError('INTERRUPTED')));
          res.on('error', () => { if (signal.aborted) abort(); else finish(new ChatError('NETWORK_FAILED')); });
          res.on('close', () => { if (!settled) finish(new ChatError('INTERRUPTED')); });
        });
        req.on('error', (error: NodeJS.ErrnoException) => {
          if (signal.aborted) abort();
          else finish(new ChatError(/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code ?? '') ? 'TLS_FAILED' : 'NETWORK_FAILED'));
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort(); else req.end(payload);
      });
    } finally { clearTimeout(headerTimer); clearTimeout(idleTimer); clearTimeout(totalTimer); agent.destroy(); }
  }
}
