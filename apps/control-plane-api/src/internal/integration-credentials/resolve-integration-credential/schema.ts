import { z } from "@hono/zod-openapi";

export const ResolveIntegrationCredentialRequestSchema = z
  .object({
    connectionId: z.string().min(1),
    bindingId: z.string().min(1).optional(),
    secretType: z.string().min(1),
    slotKey: z.string().min(1).optional(),
    resolverKey: z.string().min(1).optional(),
  })
  .strict();

export const ResolveIntegrationCredentialResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("value"),
      value: z.string().min(1),
      expiresAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("aws_session"),
      accessKeyId: z.string().min(1),
      secretAccessKey: z.string().min(1),
      sessionToken: z.string().min(1),
      expiresAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
]);
