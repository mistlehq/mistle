import { z } from "@hono/zod-openapi";

export const ResumeSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255).optional(),
  })
  .strict();

export const ResumeSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export type ResumeSandboxInstanceInput = z.infer<typeof ResumeSandboxInstanceInputSchema>;
export type ResumeSandboxInstanceAcceptedResponse = z.infer<
  typeof ResumeSandboxInstanceAcceptedResponseSchema
>;
