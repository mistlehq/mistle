import { z } from "@hono/zod-openapi";

import { ResumeSandboxInstanceAcceptedResponseSchema } from "../../../sandbox-instances/resume-sandbox-instance/schema.js";

export const ResumeSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const ResumeSandboxInstanceBodySchema = z
  .object({
    organizationId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export { ResumeSandboxInstanceAcceptedResponseSchema };
