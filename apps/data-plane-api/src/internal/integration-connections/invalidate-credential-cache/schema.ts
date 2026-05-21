import { z } from "@hono/zod-openapi";

export const InvalidateCredentialCacheParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const InvalidateCredentialCacheResponseSchema = z
  .object({
    status: z.literal("ok"),
    deletedEntryCount: z.number().int().min(0),
  })
  .strict();

export type InvalidateCredentialCacheResponse = z.infer<
  typeof InvalidateCredentialCacheResponseSchema
>;
