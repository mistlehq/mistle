import { z } from "@hono/zod-openapi";

import { StopSandboxInstanceAcceptedResponseSchema } from "../../../sandbox-instances/stop-sandbox-instance/schema.js";

export const StopSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const StopSandboxInstanceBodySchema = z.discriminatedUnion("stopReason", [
  z
    .object({
      stopReason: z.literal("idle"),
      expectedOwnerLeaseId: z.string().min(1),
      idempotencyKey: z.string().min(1).max(255),
      expectedPurpose: z.enum(["session", "setup_check"]).optional(),
    })
    .strict(),
  z
    .object({
      stopReason: z.literal("system"),
      idempotencyKey: z.string().min(1).max(255),
      expectedPurpose: z.enum(["session", "setup_check"]).optional(),
    })
    .strict(),
]);

export { StopSandboxInstanceAcceptedResponseSchema };
