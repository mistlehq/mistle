import { z } from "@hono/zod-openapi";

export const SandboxReconcileReasonsSchema = z.enum(["disconnect_grace_elapsed"]);

export const ReconcileSandboxInstanceInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    reason: SandboxReconcileReasonsSchema,
    expectedOwnerLeaseId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const ReconcileSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type ReconcileSandboxInstanceInput = z.infer<typeof ReconcileSandboxInstanceInputSchema>;
export type ReconcileSandboxInstanceAcceptedResponse = z.infer<
  typeof ReconcileSandboxInstanceAcceptedResponseSchema
>;
