import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

export const StopUserRequestedSandboxInstanceConflictResponseSchema = createCodeMessageErrorSchema(
  z.literal("USER_STOP_NOT_SUPPORTED"),
);

export const StopUserRequestedSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const StopUserRequestedSandboxInstanceBodySchema = z
  .object({
    organizationId: z.string().min(1),
    idempotencyKey: z.string().min(1).max(255),
  })
  .strict();

export const StopUserRequestedSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["accepted", "already_stopped", "already_terminal"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();

export type StopUserRequestedSandboxInstanceInput = {
  organizationId: string;
  sandboxInstanceId: string;
  idempotencyKey: string;
};

export type StopUserRequestedSandboxInstanceResponse = z.infer<
  typeof StopUserRequestedSandboxInstanceResponseSchema
>;
