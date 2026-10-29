import { describe, expect, it, vi } from 'vitest';
import { CHAT_LIMITS } from '../../shared/chat';
import { OpenAIChatStreamAdapter } from './openai-chat-stream';
import { recipient } from './test-helpers';
const frame = (content: string | null, finish: string | null = null, extra = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content, ...extra }, finish_reason: finish }] })}\n\n`;
const done = 'data: [DONE]\n\n';
function run(wire: string | Buffer, width = 1) {
  const chunks: string[] = []; const transport = { stream: vi.fn(async (_url, _key, _body, _signal, bytes: (b: Buffer) => void) => {
    const raw = Buffer.from(wire); for (let i = 0; i < raw.length; i += width) bytes(raw.subarray(i, i + width));
  }) };
  const adapter = new OpenAIChatStreamAdapter(transport);
  return { chunks, transport, result: adapter.stream(recipient(), 'mock-only-secret', [{ role: 'user', content: '你好' }], new AbortController().signal, (s) => chunks.push(s)) };
}
describe('text-only Chat Completions streaming adapter (mock transport)', () => {
  it('accepts role-only/empty choices/usage frames and emits exact Unicode text', async () => {
    const f = run('data: {"choices":[]}\n\n' + frame(null, null, { role: 'assistant' }) + frame('你好😀') + frame(null,'stop') + done);
    expect(await f.result).toBe('stop'); expect(f.chunks.join('')).toBe('你好😀');
    expect(f.transport.stream).toHaveBeenCalledOnce();
    expect(f.transport.stream.mock.calls[0]?.[2]).toMatchObject({ stream: true, n: 1, max_completion_tokens: 2048, messages: [{ role: 'user', content: '你好' }] });
  });
  it.each(['length','content_filter'])('returns %s distinctly; never upgrades it to completed', async (finish) => {
    expect(await run(frame('partial') + frame(null,finish) + done).result).toBe(finish);
  });
  it.each([
    [frame('partial'), 'INTERRUPTED'], [frame('partial', 'stop'), 'INTERRUPTED'],
    [done,'PROTOCOL_ERROR'], [frame('', 'stop') + done,'EMPTY_RESPONSE'],
    ['data: nope\n\n','PROTOCOL_ERROR'], ['data: {"error":{"message":"mock-only-secret"}}\n\n','PROTOCOL_ERROR'],
    [frame(null,null,{tool_calls: []}),'TOOLS_FORBIDDEN'], [frame(null,'tool_calls'),'TOOLS_FORBIDDEN'],
    [frame(null,null,{function_call:{name:'forbidden'}}),'TOOLS_FORBIDDEN'], [frame(null,'function_call'),'TOOLS_FORBIDDEN'],
    [frame(null,null,{refusal:'no'}),'CONTENT_FILTERED'], [frame('bad\u0000'),'PROTOCOL_ERROR'],
    [frame('ok','stop') + frame('late') + done,'PROTOCOL_ERROR'],
  ])('rejects unsafe or unfinished response %#', async (wire, code) => {
    const f = run(wire!); await expect(f.result).rejects.toThrow(code); expect(f.transport.stream).toHaveBeenCalledOnce();
  });
  it('caps decoded output even when small events collectively exceed the limit', async () => {
    const f = run(frame('x'.repeat(40_000)) + frame('y'.repeat(30_000)), 4096);
    await expect(f.result).rejects.toThrow('RESPONSE_TOO_LARGE');
    expect(Buffer.byteLength(f.chunks.join(''))).toBeLessThanOrEqual(CHAT_LIMITS.outputBytes);
  });
  it('withholds a reflected key split across frames and never emits the secret', async () => {
    const f = run(frame('safe mock-only-') + frame('secret') + frame(null,'stop') + done);
    await expect(f.result).rejects.toThrow('PROTOCOL_ERROR'); expect(f.chunks.join('')).toBe('safe ');
  });
  it('allows a nonsecret prefix at a valid end and rejects late bytes after DONE', async () => {
    const f = run(frame('a mock') + frame(null,'stop') + done); expect(await f.result).toBe('stop'); expect(f.chunks.join('')).toBe('a mock');
    await expect(run(frame('ok','stop') + done + frame('late'), 100_000).result).rejects.toThrow('PROTOCOL_ERROR');
  });
});
