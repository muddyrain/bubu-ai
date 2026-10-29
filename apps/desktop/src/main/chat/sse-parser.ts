import { CHAT_LIMITS } from '../../shared/chat';
import { ChatError } from './errors';

// Framing only. The adapter validates each dispatched JSON object separately.
export class SseParser {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private line = '';
  private data: string[] = [];
  private frameBytes = 0;
  private total = 0;
  private count = 0;
  private afterCr = false;
  private ended = false;
  constructor(private readonly onData: (data: string) => void) {}
  push(chunk: Uint8Array): void {
    if (this.ended) throw new ChatError('PROTOCOL_ERROR');
    this.total += chunk.byteLength;
    if (this.total > CHAT_LIMITS.responseBytes) throw new ChatError('RESPONSE_TOO_LARGE');
    let decoded: string;
    try { decoded = this.decoder.decode(chunk, { stream: true }); } catch { throw new ChatError('PROTOCOL_ERROR'); }
    this.consume(decoded);
  }
  private consume(value: string): void {
    for (const char of value) {
      if (this.afterCr) { this.afterCr = false; if (char === '\n') continue; }
      if (char === '\r' || char === '\n') {
        this.processLine(); this.line = ''; this.afterCr = char === '\r';
      } else {
        this.frameBytes += Buffer.byteLength(char);
        if (this.frameBytes > CHAT_LIMITS.eventBytes) throw new ChatError('RESPONSE_TOO_LARGE');
        this.line += char;
      }
    }
  }
  private processLine(): void {
    if (!this.line) {
      if (++this.count > CHAT_LIMITS.events) throw new ChatError('RESPONSE_TOO_LARGE');
      const data = this.data.join('\n'); this.data = []; this.frameBytes = 0;
      if (data) this.onData(data);
      return;
    }
    if (this.line.startsWith(':')) return;
    const colon = this.line.indexOf(':');
    const field = colon < 0 ? this.line : this.line.slice(0, colon);
    let value = colon < 0 ? '' : this.line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event' && value && value !== 'message') throw new ChatError('PROTOCOL_ERROR');
    // id/retry never cause a reconnect or another HTTP request.
  }
  finish(): void {
    try { this.consume(this.decoder.decode()); } catch (error) { if (error instanceof ChatError) throw error; throw new ChatError('PROTOCOL_ERROR'); }
    this.ended = true;
    if (this.line || this.data.length) throw new ChatError('PROTOCOL_ERROR');
  }
}
