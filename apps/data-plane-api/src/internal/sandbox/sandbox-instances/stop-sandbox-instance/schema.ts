import { z } from "@hono/zod-openapi";

import {
  StopSandboxInstanceConflictResponseSchema,
  StopSandboxInstanceResponseSchema,
} from "../../../sandbox-instances/stop-sandbox-instance/schema.js";

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
    })
    .strict(),
  z
    .object({
      stopReason: z.literal("user"),
      organizationId: z.string().min(1),
      idempotencyKey: z.string().min(1).max(255),
    })
    .strict(),
]);

export { StopSandboxInstanceConflictResponseSchema, StopSandboxInstanceResponseSchema };
