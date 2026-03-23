import { z } from "@hono/zod-openapi";

export const IngestIntegrationWebhookResponseSchema = z
  .object({
    status: z.enum(["received", "duplicate"]),
  })
  .strict();
