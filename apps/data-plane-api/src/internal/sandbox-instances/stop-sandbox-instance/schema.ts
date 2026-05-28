import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

const StopSandboxInstanceBaseInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const StopSandboxInstanceInputSchema = z.discriminatedUnion("stopReason", [
  StopSandboxInstanceBaseInputSchema.extend({
    stopReason: z.literal("idle"),
    expectedOwnerLeaseId: z.string().min(1),
  }).strict(),
  StopSandboxInstanceBaseInputSchema.extend({
    stopReason: z.literal("user"),
    organizationId: z.string().min(1),
  }).strict(),
]);

export const StopSandboxInstanceConflictResponseSchema = createCodeMessageErrorSchema(
  z.literal("USER_STOP_NOT_SUPPORTED"),
);

export const StopSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["accepted", "already_stopped", "already_terminal"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();

export const StopSandboxInstanceAcceptedResponseSchema = StopSandboxInstanceResponseSchema;

export type StopSandboxInstanceInput = z.infer<typeof StopSandboxInstanceInputSchema>;
export type StopSandboxInstanceResponse = z.infer<typeof StopSandboxInstanceResponseSchema>;
export type StopSandboxInstanceAcceptedResponse = StopSandboxInstanceResponse;
