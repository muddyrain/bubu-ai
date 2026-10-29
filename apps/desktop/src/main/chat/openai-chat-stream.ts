import { z } from 'zod';
import { CHAT_LIMITS } from '../../shared/chat';
import type { ChatRecipient } from '../../shared/chat';
import { ChatError, checkSignal, hasUnsafeControls } from './errors';
import { SseParser } from './sse-parser';
import type { ChatStreamTransport } from './stream-transport';

export interface ContextMessage { role: 'user' | 'assistant'; content: string }
export interface ChatAdapter {
  stream(recipient: ChatRecipient, key: string, messages: ContextMessage[], signal: AbortSignal,
    onText: (text: string) => void): Promise<'stop' | 'length' | 'content_filter'>;
}
const deltaSchema = z.object({ choices: z.array(z.object({ index: z.literal(0),
  delta: z.object({ role: z.literal('assistant').optional(), content: z.string().nullable().optional(),
    refusal: z.string().nullable().optional(), tool_calls: z.unknown().optional(), function_call: z.unknown().optional(), audio: z.unknown().optional(),
  }), finish_reason: z.enum(['stop','length','content_filter','tool_calls','function_call']).nullable().optional(),
})).max(1), error: z.unknown().optional() });

export class OpenAIChatStreamAdapter implements ChatAdapter {
  constructor(private readonly transport: ChatStreamTransport) {}
  async stream(recipient: ChatRecipient, key: string, messages: ContextMessage[], signal: AbortSignal, onText: (text: string) => void) {
    let done = false, finish: 'stop' | 'length' | 'content_filter' | undefined, visible = '', bytes = 0, held = '';
    // Keep only a possible prefix of the secret: even an echoed key split across
    // chunks must never be forwarded to IPC or conversation checkpoints.
    const emit = (value: string, final = false) => {
      held += value;
      if (key && held.includes(key)) throw new ChatError('PROTOCOL_ERROR');
      let suffix = final ? 0 : Math.min(key.length - 1, held.length);
      while (suffix > 0 && !held.endsWith(key.slice(0, suffix))) suffix--;
      const safe = held.slice(0, held.length - suffix); held = held.slice(held.length - suffix);
      if (safe) onText(safe);
    };
    const parser = new SseParser((data) => {
      checkSignal(signal);
      if (done) throw new ChatError('PROTOCOL_ERROR');
      if (data === '[DONE]') { if (!finish) throw new ChatError('PROTOCOL_ERROR'); done = true; return; }
      let value: unknown;
      try { value = JSON.parse(data); } catch { throw new ChatError('PROTOCOL_ERROR'); }
      const parsed = deltaSchema.safeParse(value);
      if (!parsed.success || parsed.data.error !== undefined) throw new ChatError('PROTOCOL_ERROR');
      const choice = parsed.data.choices[0];
      if (!choice) return;
      if (finish) throw new ChatError('PROTOCOL_ERROR');
      const d = choice.delta;
      if (d.tool_calls != null || d.function_call != null || choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') throw new ChatError('TOOLS_FORBIDDEN');
      if (d.audio != null) throw new ChatError('PROTOCOL_ERROR');
      if (d.refusal) throw new ChatError('CONTENT_FILTERED');
      if (d.content) {
        if (hasUnsafeControls(d.content)) throw new ChatError('PROTOCOL_ERROR');
        bytes += Buffer.byteLength(d.content);
        if (bytes > CHAT_LIMITS.outputBytes) throw new ChatError('RESPONSE_TOO_LARGE');
        visible += d.content; emit(d.content);
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    });
    await this.transport.stream(recipient.baseUrl, key, { model: recipient.modelId, stream: true, n: 1,
      max_completion_tokens: CHAT_LIMITS.completionTokens, messages }, signal, (chunk) => { parser.push(chunk); return done; });
    checkSignal(signal); parser.finish();
    if (!done || !finish) throw new ChatError('INTERRUPTED');
    if (finish === 'stop' && !visible.trim()) throw new ChatError('EMPTY_RESPONSE');
    emit('', true);
    return finish;
  }
}
