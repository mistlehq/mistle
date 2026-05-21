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
    actingUserId: z.string().min(1).optional(),
    gitIdentity: z
      .object({
        name: z.string().min(1),
        email: z.email(),
        signing: z
          .object({
            format: z.literal("ssh"),
            program: z.string().min(1),
            keyRef: z.string().min(1),
            organizationId: z.string().min(1),
            providerFamily: z.string().min(1),
            integrationConnectionId: z.string().min(1),
            actingUserId: z.string().min(1),
          })
          .strict()
          .optional(),
      })
      .optional(),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export { ResumeSandboxInstanceAcceptedResponseSchema };
