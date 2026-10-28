import { z } from 'zod';
import { hasControlCharacters } from './errors';

export const idSchema = z.uuid();
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const label = (max: number) => z.string().trim().min(1).max(max).refine((s) => !hasControlCharacters(s));
export const saveSchema = z.strictObject({
  id: idSchema.optional(), expectedRevision: revision.optional(), name: label(80),
  protocol: z.literal('openai-compatible-chat-completions'), baseUrl: label(2048),
  modelId: label(256), enabled: z.boolean(),
  key: z.discriminatedUnion('action', [
    z.strictObject({ action: z.literal('keep') }), z.strictObject({ action: z.literal('remove') }),
    z.strictObject({ action: z.literal('replace'), value: z.string().min(1).max(8192).refine((s) => Buffer.byteLength(s, 'utf8') <= 8192 && !/\s/.test(s) && !hasControlCharacters(s)) }),
  ]),
}).refine((input) => Boolean(input.id) === Boolean(input.expectedRevision));
export const targetSchema = z.strictObject({ id: idSchema, expectedRevision: revision });
export const cancelSchema = z.strictObject({ requestId: idSchema });
export const probeSchema = z.strictObject({
  id: idSchema, revision, requestId: idSchema,
  consent: z.strictObject({ origin: z.string().max(2048), accepted: z.literal(true) }),
});
const code = z.enum(['INVALID_INPUT','UNTRUSTED_SENDER','STORAGE_UNAVAILABLE','CREDENTIAL_UNAVAILABLE',
  'STORE_FAILED','STORE_CORRUPT','CONFLICT','NOT_FOUND','KEY_REQUIRED','NOT_READY','LIMIT_REACHED',
  'URL_BLOCKED','DNS_BLOCKED','DNS_FAILED','REDIRECT_BLOCKED','AUTH_FAILED','MODEL_NOT_FOUND',
  'RATE_LIMITED','TLS_FAILED','TIMEOUT','CANCELLED','BUSY','RESPONSE_TOO_LARGE','PROTOCOL_ERROR','NETWORK_FAILED']);
const evidence = z.strictObject({ profileId: idSchema, revision, requestId: idSchema,
  probeVersion: z.literal(1), checkedAt: z.iso.datetime(),
  outcome: z.enum(['passed','failed','supported','unsupported','unknown']), code: code.optional() });
export const storedProfileSchema = z.strictObject({
  id: idSchema, name: label(80), protocol: z.literal('openai-compatible-chat-completions'),
  baseUrl: label(2048), modelId: label(256), enabled: z.boolean(), revision,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), credentialRef: idSchema.nullable(),
  connection: evidence.optional(), tools: evidence.optional(),
});
export const storeSchema = z.strictObject({ schemaVersion: z.literal(1),
  selectedProfileId: idSchema.nullable(), profiles: z.array(storedProfileSchema).max(20) });
export type StoredProfile = z.infer<typeof storedProfileSchema>;
export type ProfileStoreData = z.infer<typeof storeSchema>;
