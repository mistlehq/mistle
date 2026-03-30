import { z } from "@hono/zod-openapi";

import {
  ReconcileSandboxInstanceAcceptedResponseSchema,
  SandboxReconcileReasonsSchema,
} from "../../../sandbox-instances/reconcile-sandbox-instance/schema.js";

export const ReconcileSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const ReconcileSandboxInstanceBodySchema = z
  .object({
    reason: SandboxReconcileReasonsSchema,
    expectedOwnerLeaseId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export { ReconcileSandboxInstanceAcceptedResponseSchema };
