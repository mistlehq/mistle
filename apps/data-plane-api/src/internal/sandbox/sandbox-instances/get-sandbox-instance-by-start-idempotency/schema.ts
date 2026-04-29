import { z } from "@hono/zod-openapi";

import { StartSandboxInstanceAcceptedResponseSchema } from "../../../sandbox-instances/start-sandbox-instance/schema.js";

export const GetSandboxInstanceByStartIdempotencyQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.coerce.number().int().min(1),
    purpose: z.enum(["session", "setup_check"]),
    source: z.enum(["dashboard", "webhook", "system"]),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const GetSandboxInstanceByStartIdempotencyResponseSchema =
  StartSandboxInstanceAcceptedResponseSchema.nullable();
