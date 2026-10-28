import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from './test-helpers';
import { HttpsProviderTransport, normalizeBaseUrl, providerEndpoint, publicAddress } from './provider-transport';
import type { TransportDependencies } from './provider-transport';

function fixture(options: { status?: number; response?: string | Buffer; error?: string; stall?: boolean } = {}) {
  const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
  let captured!: RequestOptions;
  const end = vi.fn();
  const request = vi.fn((url: URL, opts: RequestOptions, callback: (res: IncomingMessage) => void) => {
    captured = opts;
    expect(url.href).toBe('https://provider.example/v1/chat/completions');
    const req = new EventEmitter() as ClientRequest;
    req.destroy = vi.fn(() => req);
    req.end = end.mockImplementation(() => {
      queueMicrotask(() => {
        if (options.error) { req.emit('error', { code: options.error, message: 'private fixture-only-key' }); return; }
        if (options.stall) return;
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = options.status ?? 200; res.destroy = vi.fn(() => res);
        callback(res);
        res.emit('data', Buffer.isBuffer(options.response) ? options.response : Buffer.from(options.response ?? '{"choices":[]}'));
        res.emit('end');
      });
      return req;
    });
    const signal = opts.signal;
    const abort = () => req.emit('error', { code: 'ABORT_ERR' });
    signal?.addEventListener('abort', abort, { once: true });
    req.once('close', () => signal?.removeEventListener('abort', abort));
    return req;
  });
  return { resolve, request, end, captured: () => captured,
    transport: new HttpsProviderTransport({ resolve, request: request as unknown as TransportDependencies['request'] }) };
}
afterEach(() => vi.useRealTimers());
describe('provider URL policy', () => {
  it.each([['https://provider.example/v1/','https://provider.example/v1/chat/completions'],
    ['https://provider.example:443/api/v3','https://provider.example/api/v3/chat/completions']])('builds the final endpoint from %s', (base, endpoint) => {
    expect(providerEndpoint(base!).href).toBe(endpoint);
    expect(normalizeBaseUrl(base!)).toBe(endpoint!.replace('/chat/completions',''));
  });
  it.each(['http://provider.example/v1','https://localhost/v1','https://127.0.0.1/v1','https://2130706433/v1',
    'https://0x7f000001/v1','https://0177.0.0.1/v1','https://[::1]/v1','https://[::ffff:127.0.0.1]/v1',
    'https://provider.example:8443/v1','https://key@provider.example/v1','https://provider.example/v1?key=secret',
    'https://provider.example/v1#fragment','file:///tmp/model','https://provider.example./v1',
    'https://foo.local/v1','https://provider.example/v1/../other','https://provider.example/%2e%2e/v1',
    'https://provider.example//v1','https://provider.example/v1\\other','https://provider.example/v1\u0000'])('blocks %s', (value) => {
    expect(() => providerEndpoint(value)).toThrow('URL_BLOCKED');
  });
  it.each(['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1',
    '0.0.0.0','224.0.0.1','198.18.0.1','192.0.2.1','::','::1','fc00::1','fe80::1',
    '2001:db8::1','::ffff:93.184.216.34','2002:7f00:1::','64:ff9b::a00:1','fe80::1%lo0'])('rejects private/reserved/mapped address %s', (address) => {
    expect(publicAddress(address)).toBe(false);
  });
});
describe('HTTPS transport with mocked DNS and sockets', () => {
  it('pins the actual connection to checked DNS, preserves SNI and TLS verification, and sends one bounded request', async () => {
    const f = fixture();
    await f.transport.post('https://provider.example/v1','fixture-only-key',{ model: 'fixture' },new AbortController().signal);
    const options = f.captured();
    expect(options).toMatchObject({ method: 'POST', servername: 'provider.example', rejectUnauthorized: true, family: 4 });
    const callback = vi.fn();
    (options.lookup as (host: string, options: object, callback: (...args: unknown[]) => void) => void)('provider.example', {}, callback);
    expect(callback).toHaveBeenCalledWith(null,'93.184.216.34',4);
    expect(f.resolve).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.end).toHaveBeenCalledWith('{"model":"fixture"}');
  });
  it('rejects all DNS answers if even one is private (including rebinding mixtures)', async () => {
    const f = fixture(); f.resolve.mockResolvedValue([{ address:'93.184.216.34',family:4 },{ address:'127.0.0.1',family:4 }]);
    await expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},new AbortController().signal)).rejects.toThrow('DNS_BLOCKED');
    expect(f.request).not.toHaveBeenCalled();
  });
  it('resolves afresh for each request, and blocks a domain that later becomes private', async () => {
    const f = fixture(); const signal = new AbortController().signal;
    await f.transport.post('https://provider.example/v1','fixture-only-key',{},signal);
    f.resolve.mockResolvedValue([{ address:'169.254.169.254',family:4 }]);
    await expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},signal)).rejects.toThrow('DNS_BLOCKED');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each([301,302,307,308])('rejects redirect %s without retrying or forwarding the key', async (status) => {
    const f = fixture({status});
    await expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},new AbortController().signal)).rejects.toThrow('REDIRECT_BLOCKED');
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it.each(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_TLS_CERT_ALTNAME_INVALID'])('fails TLS closed: %s', async (error) => {
    const f = fixture({error});
    await expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},new AbortController().signal)).rejects.toThrow('TLS_FAILED');
  });
  it('limits response bytes', async () => {
    const f = fixture({response:Buffer.alloc(131073)});
    await expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},new AbortController().signal)).rejects.toThrow('RESPONSE_TOO_LARGE');
  });
  it('cancels a pending DNS resolution without ever opening a socket', async () => {
    const f = fixture(); const dns = deferred<{address:string;family:number}[]>();
    f.resolve.mockReturnValue(dns.promise); const controller = new AbortController();
    const result = expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},controller.signal)).rejects.toThrow('CANCELLED');
    controller.abort(); await result; dns.resolve([{address:'93.184.216.34',family:4}]);
    expect(f.request).not.toHaveBeenCalled();
  });
  it('bounds DNS plus socket time and distinguishes timeout from cancellation', async () => {
    vi.useFakeTimers(); const f=fixture({stall:true});
    vi.spyOn(AbortSignal,'timeout').mockImplementation((ms) => {
      const deadline = new AbortController(); setTimeout(() => deadline.abort(new DOMException('Timeout','TimeoutError')), ms); return deadline.signal;
    });
    const result=expect(f.transport.post('https://provider.example/v1','fixture-only-key',{},new AbortController().signal)).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(20000); await result;
  });
});
