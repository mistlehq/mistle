import { z } from "zod";

export const ResolveIntegrationCredentialRequestSchema = z
  .object({
    connectionId: z.string().min(1),
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

export const InternalIntegrationCredentialErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
