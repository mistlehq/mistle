import { z } from "@hono/zod-openapi";

export const StopSandboxInstanceInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    stopReason: z.enum(["idle", "disconnected"]),
    expectedOwnerLeaseId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const StopSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type StopSandboxInstanceInput = z.infer<typeof StopSandboxInstanceInputSchema>;
export type StopSandboxInstanceAcceptedResponse = z.infer<
  typeof StopSandboxInstanceAcceptedResponseSchema
>;
