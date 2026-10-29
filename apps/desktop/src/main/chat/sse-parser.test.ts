import { describe, expect, it } from 'vitest';
import { CHAT_LIMITS } from '../../shared/chat';
import { SseParser } from './sse-parser';

describe('bounded incremental SSE framing', () => {
  it('decodes Chinese, emoji and CRLF at every possible byte boundary', () => {
    const wire = Buffer.from('\ufeff: ping\r\ndata: 你好😀\r\ndata: 第二行\r\n\r\ndata: [DONE]\n\n');
    for (let cut = 0; cut <= wire.length; cut++) {
      const events: string[] = [], parser = new SseParser((s) => events.push(s));
      parser.push(wire.subarray(0, cut)); parser.push(wire.subarray(cut)); parser.finish();
      expect(events).toEqual(['你好😀\n第二行','[DONE]']);
    }
  });
  it('handles LF, CR, empty data, comments and ignored retry/id without reconnecting', () => {
    const events: string[] = [], parser = new SseParser((s) => events.push(s));
    for (const byte of Buffer.from('retry: 1\rid: next\rdata:\r\r: ping\n\ndata: ok\r\r')) parser.push(Buffer.from([byte]));
    parser.finish(); expect(events).toEqual(['ok']);
  });
  it.each([Buffer.from([0xff]), Buffer.from('data: incomplete'), Buffer.from('data: missing-frame\n'), Buffer.from('event: error\n\n')])('fails closed on illegal or incomplete SSE %#', (wire) => {
    const parser = new SseParser(() => {});
    expect(() => { parser.push(wire); parser.finish(); }).toThrow('PROTOCOL_ERROR');
  });
  it('rejects a UTF-8 sequence truncated at EOF', () => {
    const parser = new SseParser(() => {}); parser.push(Buffer.from([0xe4,0xbd])); expect(() => parser.finish()).toThrow('PROTOCOL_ERROR');
  });
  it('bounds a frame, total bytes and event count, including comment-only traffic', () => {
    expect(() => new SseParser(() => {}).push(Buffer.from(':' + 'x'.repeat(CHAT_LIMITS.eventBytes)))).toThrow('RESPONSE_TOO_LARGE');
    expect(() => new SseParser(() => {}).push(Buffer.alloc(CHAT_LIMITS.responseBytes + 1))).toThrow('RESPONSE_TOO_LARGE');
    expect(() => new SseParser(() => {}).push(Buffer.from('\n'.repeat(CHAT_LIMITS.events + 1)))).toThrow('RESPONSE_TOO_LARGE');
  });
});
