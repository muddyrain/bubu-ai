import { z } from 'zod';
import { CHAT_ERROR_CODES, CHAT_LIMITS } from '../../shared/chat';
import type { Conversation } from '../../shared/chat';
import { normalizeBaseUrl } from '../providers/provider-transport';
import { hasUnsafeControls } from './errors';

export const uuid = z.uuid();
export const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const text = (bytes: number) => z.string().max(bytes).refine((s) => Buffer.byteLength(s) <= bytes && !hasUnsafeControls(s));
export const recipientSchema = z.strictObject({ providerId: uuid, revision, name: z.string().min(1).max(80),
  baseUrl: z.string().max(2048).refine((s) => { try { return normalizeBaseUrl(s) === s; } catch { return false; } }),
  origin: z.string().max(2048), modelId: z.string().min(1).max(256),
}).refine((r) => { try { return new URL(r.baseUrl).origin === r.origin; } catch { return false; } });
export const messageSchema = z.strictObject({ id: uuid, requestId: uuid, runId: uuid,
  role: z.enum(['user','assistant']), text: text(CHAT_LIMITS.outputBytes), status: z.enum(['pending','streaming','completed','stopped','failed']),
  recipient: recipientSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), seq: z.number().int().min(0).max(100_000),
  finishReason: z.enum(['stop','length','content_filter']).optional(), errorCode: z.enum(CHAT_ERROR_CODES).optional(),
});
export const conversationSchema = z.strictObject({ schemaVersion: z.literal(1), id: uuid, revision,
  title: z.string().min(1).max(80), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), lastRecipient: recipientSchema.nullable(),
  messages: z.array(messageSchema).max(CHAT_LIMITS.messages),
}).superRefine((c, ctx) => {
  const fail = () => ctx.addIssue({ code: 'custom', message: 'Invalid conversation' });
  if (!c.messages.length && c.lastRecipient !== null) fail();
  if (c.messages.length % 2 || new Set(c.messages.map((m) => m.id)).size !== c.messages.length) fail();
  const ids = new Set<string>();
  for (let i = 0; i < c.messages.length; i += 2) {
    const u = c.messages[i]!, a = c.messages[i + 1];
    if (!a || u.role !== 'user' || a.role !== 'assistant' || u.status !== 'completed' || !u.text.trim() ||
      Buffer.byteLength(u.text) > CHAT_LIMITS.inputBytes || u.finishReason || u.errorCode || u.seq !== 0 ||
      u.runId !== a.runId || u.requestId !== a.requestId || JSON.stringify(u.recipient) !== JSON.stringify(a.recipient) ||
      ids.has(u.requestId) || ids.has(u.runId)) { fail(); continue; }
    ids.add(u.requestId); ids.add(u.runId);
    if ((a.status === 'completed' && (a.finishReason !== 'stop' || a.errorCode || !a.text.trim())) ||
      (a.status === 'failed' && !a.errorCode) || (['pending','streaming'].includes(a.status) && (a.errorCode || a.finishReason)) ||
      (i < c.messages.length - 2 && ['pending','streaming'].includes(a.status))) fail();
  }
  if (c.messages.length && JSON.stringify(c.lastRecipient) !== JSON.stringify(c.messages.at(-1)!.recipient)) fail();
});
export function validateConversation(value: unknown): Conversation {
  return conversationSchema.parse(value);
}
export const targetSchema = z.strictObject({ conversationId: uuid });
export const removeSchema = targetSchema.extend({ expectedRevision: revision });
export const subscriptionSchema = z.strictObject({ subscriptionId: uuid });
export const cancelSchema = z.strictObject({ requestId: uuid });
export const prepareSchema = z.strictObject({ conversationId: uuid, expectedRevision: revision, requestId: uuid,
  text: text(CHAT_LIMITS.inputBytes).refine((s) => Boolean(s.trim())),
});
export const sendSchema = z.strictObject({ planId: uuid, subscriptionId: uuid, accepted: z.literal(true).optional() });
