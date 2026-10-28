import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CONNECTION_MESSAGE, TOOL_MESSAGE } from '../../shared/providers';
import type { ProviderProfile } from '../../shared/providers';
import { ProviderError } from './errors';
import type { ProviderTransport } from './provider-transport';

const responseSchema = z.object({ choices: z.array(z.object({ message: z.object({
  role: z.literal('assistant'), content: z.string().max(65536).nullable().optional(),
  tool_calls: z.array(z.object({ id: z.string().min(1).max(256), type: z.literal('function'),
    function: z.object({ name: z.string().max(64), arguments: z.string().max(4096) }),
  })).max(8).optional(),
}) })).min(1).max(8) });
const toolError = z.object({ error: z.object({ code: z.enum(['unsupported_parameter','unsupported_feature']),
  param: z.enum(['tools','tool_choice']) }) });

export class OpenAIChatCompletionsAdapter {
  constructor(private readonly transport: ProviderTransport) {}
  async probe(profile: Pick<ProviderProfile, 'baseUrl' | 'modelId'>, key: string,
    kind: 'connection' | 'tools', signal: AbortSignal): Promise<'passed' | 'supported' | 'unsupported' | 'unknown'> {
    const nonce = randomUUID();
    const tools = [{ type: 'function', function: { name: 'bubu_capability_probe',
      description: 'A capability probe; no function will be executed.', parameters: {
        type: 'object', properties: { nonce: { type: 'string', enum: [nonce] } },
        required: ['nonce'], additionalProperties: false,
      } } }];
    const body = {
      model: profile.modelId, stream: false, max_completion_tokens: 64,
      messages: [{ role: 'user', content: kind === 'connection' ? CONNECTION_MESSAGE : `${TOOL_MESSAGE} Nonce: ${nonce}` }],
      ...(kind === 'tools' ? { tools, tool_choice: { type: 'function', function: { name: 'bubu_capability_probe' } } } : {}),
    };
    const response = await this.transport.post(profile.baseUrl, key, body, signal);
    if (kind === 'tools' && response.status === 400 && toolError.safeParse(response.body).success) return 'unsupported';
    if (response.status === 401 || response.status === 403) throw new ProviderError('AUTH_FAILED');
    if (response.status === 404) throw new ProviderError('MODEL_NOT_FOUND');
    if (response.status === 429) throw new ProviderError('RATE_LIMITED');
    if (response.status >= 500) throw new ProviderError('NETWORK_FAILED');
    if (response.status !== 200) throw new ProviderError('PROTOCOL_ERROR');
    const parsed = responseSchema.safeParse(response.body);
    if (!parsed.success) throw new ProviderError('PROTOCOL_ERROR');
    const message = parsed.data.choices[0]!.message;
    if (kind === 'connection') {
      if (typeof message.content !== 'string' || !message.content.trim()) throw new ProviderError('PROTOCOL_ERROR');
      return 'passed';
    }
    const calls = message.tool_calls;
    if (calls?.length !== 1 || calls[0]!.function.name !== 'bubu_capability_probe') return 'unknown';
    let args: unknown;
    try { args = JSON.parse(calls[0]!.function.arguments); } catch { return 'unknown'; }
    return z.strictObject({ nonce: z.literal(nonce) }).safeParse(args).success ? 'supported' : 'unknown';
  }
}
