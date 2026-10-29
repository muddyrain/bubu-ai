import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TransportDependencies } from '../providers/provider-transport';
import { CHAT_LIMITS } from '../../shared/chat';
import { ChatError } from './errors';
import { HttpsChatStreamTransport } from './stream-transport';
import { deferred } from './test-helpers';

function fixture(config: { status?: number; type?: string; encoding?: string; tls?: string; stallHeaders?: boolean; live?: boolean; wire?: Buffer } = {}) {
  const resolve = vi.fn(async () => [{address:'93.184.216.34',family:4}]);
  let captured!: RequestOptions, req!: ClientRequest, res!: IncomingMessage;
  const started = deferred<void>(), end = vi.fn();
  const request = vi.fn((url: URL, options: RequestOptions, callback: (r: IncomingMessage) => void) => {
    captured = options; expect(url.href).toBe('https://provider.example/v1/chat/completions');
    req = new EventEmitter() as ClientRequest; req.destroy = vi.fn(() => req);
    req.end = end.mockImplementation(() => { queueMicrotask(() => {
      if (config.tls) { req.emit('error',{code:config.tls,message:'private'}); started.resolve(); return; }
      if (!config.stallHeaders) {
        res = new EventEmitter() as IncomingMessage; res.statusCode = config.status ?? 200;
        res.headers = { 'content-type': config.type ?? 'text/event-stream; charset=utf-8', ...(config.encoding ? {'content-encoding':config.encoding} : {}) };
        res.destroy = vi.fn(() => res); callback(res);
        if (!config.live) { res.emit('data',config.wire ?? Buffer.from('data: mock\n\n')); res.emit('end'); }
      }
      started.resolve();
    }); return req; });
    return req;
  });
  const transport = new HttpsChatStreamTransport({resolve,request:request as unknown as TransportDependencies['request']});
  const controller = new AbortController(), bytes = vi.fn();
  return { transport, resolve, request, end, controller, bytes, started, options:()=>captured, req:()=>req, res:()=>res,
    run: () => transport.stream('https://provider.example/v1','mock-only-secret',{},controller.signal,bytes) };
}
afterEach(() => vi.useRealTimers());
describe('stream transport with mock DNS and HTTPS sockets only', () => {
  it('pins DNS at connect time with SNI, certificate validation and no shared agent/retry', async () => {
    const f = fixture(); await f.run(); const options = f.options();
    expect(options).toMatchObject({servername:'provider.example',rejectUnauthorized:true,family:4,maxHeaderSize:16384,headers:{Accept:'text/event-stream','Accept-Encoding':'identity'}});
    const callback = vi.fn(); (options.lookup as (h:string,o:object,c:(...a:unknown[])=>void)=>void)('provider.example',{},callback);
    expect(callback).toHaveBeenCalledWith(null,'93.184.216.34',4); expect(f.resolve).toHaveBeenCalledOnce(); expect(f.request).toHaveBeenCalledOnce();
    expect(f.req().destroy).toHaveBeenCalledOnce(); expect(f.res().destroy).toHaveBeenCalledOnce();
  });
  it.each([[],[{address:'127.0.0.1',family:4}],[{address:'93.184.216.34',family:6}], [{address:'93.184.216.34',family:4},{address:'169.254.169.254',family:4}]].map((addresses)=>({addresses})))('rejects unsafe DNS set %# before opening a socket', async ({addresses}) => {
    const f = fixture(); f.resolve.mockResolvedValue(addresses); await expect(f.run()).rejects.toThrow('DNS_BLOCKED'); expect(f.request).not.toHaveBeenCalled();
  });
  it('does not reuse a cached DNS result when the next result is private', async () => {
    const f = fixture(); await f.run(); f.resolve.mockResolvedValue([{address:'10.0.0.1',family:4}]);
    await expect(f.run()).rejects.toThrow('DNS_BLOCKED'); expect(f.request).toHaveBeenCalledOnce();
  });
  it.each([[301,'REDIRECT_BLOCKED'],[302,'REDIRECT_BLOCKED'],[307,'REDIRECT_BLOCKED'],[308,'REDIRECT_BLOCKED'],[401,'AUTH_FAILED'],[403,'AUTH_FAILED'],[404,'MODEL_NOT_FOUND'],[429,'RATE_LIMITED'],[500,'NETWORK_FAILED']])('rejects HTTP %s without retry', async (status,code) => {
    const f = fixture({status:status as number}); await expect(f.run()).rejects.toThrow(code as string); expect(f.request).toHaveBeenCalledOnce();
  });
  it.each(['CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT'])('keeps TLS validation fail-closed: %s', async (tls) => {
    await expect(fixture({tls}).run()).rejects.toThrow('TLS_FAILED');
  });
  it.each([{type:'application/json'},{type:'text/event-stream; charset=latin1'},{encoding:'gzip'}])('rejects an unexpected response protocol %#', async (config) => {
    await expect(fixture(config).run()).rejects.toThrow('PROTOCOL_ERROR');
  });
  it('bounds raw response bytes before calling the SSE consumer', async () => {
    const f = fixture({wire:Buffer.alloc(CHAT_LIMITS.responseBytes+1)}); await expect(f.run()).rejects.toThrow('RESPONSE_TOO_LARGE'); expect(f.bytes).not.toHaveBeenCalled();
  });
  it('aborts delayed DNS without opening any socket', async () => {
    const f = fixture(), dns = deferred<{address:string;family:number}[]>(); f.resolve.mockReturnValue(dns.promise);
    const result = expect(f.run()).rejects.toThrow('CANCELLED'); f.controller.abort(new ChatError('CANCELLED')); await result;
    dns.resolve([{address:'93.184.216.34',family:4}]); expect(f.request).not.toHaveBeenCalled();
  });
  it('destroys the actual live request and response on stop', async () => {
    const f = fixture({live:true}); const result = expect(f.run()).rejects.toThrow('CANCELLED'); await f.started.promise;
    f.controller.abort(new ChatError('CANCELLED')); await result; expect(f.req().destroy).toHaveBeenCalledOnce(); expect(f.res().destroy).toHaveBeenCalledOnce();
  });
  it('rejects abnormal socket close instead of accepting it as a valid EOF', async () => {
    const f = fixture({live:true}); const result = expect(f.run()).rejects.toThrow('INTERRUPTED'); await f.started.promise; f.res().emit('close'); await result;
  });
  it('ends and destroys a connection immediately when the SSE adapter accepts DONE', async () => {
    const f = fixture({live:true}); f.bytes.mockReturnValue(true); const result = f.run(); await f.started.promise;
    f.res().emit('data',Buffer.from('done')); await result; expect(f.req().destroy).toHaveBeenCalledOnce();
  });
  it('separates first-header, network-idle and total deadlines; comment bytes keep the idle deadline alive', async () => {
    vi.useFakeTimers(); const headers = fixture({stallHeaders:true}); const timeout = expect(headers.run()).rejects.toThrow('TIMEOUT');
    await vi.advanceTimersByTimeAsync(20_000); await timeout;
    const idle = fixture({live:true}); const timed = expect(idle.run()).rejects.toThrow('NETWORK_IDLE'); await idle.started.promise;
    await vi.advanceTimersByTimeAsync(59_000); idle.res().emit('data',Buffer.from(':ping\n\n'));
    await vi.advanceTimersByTimeAsync(59_000); expect(idle.req().destroy).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(1000); await timed;
    const total = fixture({live:true}); const hard = expect(total.run()).rejects.toThrow('TIMEOUT'); await total.started.promise;
    for (let i=0;i<5;i++) { await vi.advanceTimersByTimeAsync(50_000); total.res().emit('data',Buffer.from(':ping\n\n')); }
    await vi.advanceTimersByTimeAsync(50_000); await hard;
  });
});
