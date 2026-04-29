import { z } from "@hono/zod-openapi";

export const StopSandboxInstanceInputSchema = z.discriminatedUnion("stopReason", [
  z
    .object({
      sandboxInstanceId: z.string().min(1),
      stopReason: z.literal("idle"),
      expectedOwnerLeaseId: z.string().min(1),
      idempotencyKey: z.string().min(1).max(255),
      expectedPurpose: z.enum(["session", "setup_check"]).optional(),
    })
    .strict(),
  z
    .object({
      sandboxInstanceId: z.string().min(1),
      stopReason: z.literal("system"),
      idempotencyKey: z.string().min(1).max(255),
      expectedPurpose: z.enum(["session", "setup_check"]).optional(),
    })
    .strict(),
]);

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
