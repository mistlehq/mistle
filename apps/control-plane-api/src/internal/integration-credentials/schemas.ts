import { z } from "@hono/zod-openapi";

export const InternalIntegrationCredentialErrorResponseSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();
