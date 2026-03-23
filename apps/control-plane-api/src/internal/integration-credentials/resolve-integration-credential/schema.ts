import { z } from "@hono/zod-openapi";

export const ResolveIntegrationCredentialRequestSchema = z
  .object({
    connectionId: z.string().min(1),
    bindingId: z.string().min(1).optional(),
    secretType: z.string().min(1),
    purpose: z.string().min(1).optional(),
    resolverKey: z.string().min(1).optional(),
  })
  .strict();

export const ResolveIntegrationCredentialResponseSchema = z
  .object({
    value: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
