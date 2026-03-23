import { z } from "@hono/zod-openapi";

export const InternalSandboxRuntimeMintConnectionRequestSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export const InternalSandboxRuntimeMintConnectionResponseSchema = z
  .object({
    instanceId: z.string().min(1),
    url: z.url(),
    token: z.string().min(1),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
