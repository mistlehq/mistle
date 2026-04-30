import { z } from "@hono/zod-openapi";

export const SetupCheckPtyDrainedInputSchema = z
  .object({
    sandboxInstanceId: z.string().min(1),
    ownerLeaseId: z.string().min(1),
  })
  .strict();

export const SetupCheckPtyDrainedIgnoredResponseSchema = z
  .object({
    status: z.literal("ignored"),
    sandboxInstanceId: z.string().min(1),
  })
  .strict();

export const SetupCheckPtyDrainedAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

export const SetupCheckPtyDrainedResponseSchema = z.discriminatedUnion("status", [
  SetupCheckPtyDrainedIgnoredResponseSchema,
  SetupCheckPtyDrainedAcceptedResponseSchema,
]);

export type SetupCheckPtyDrainedInput = z.infer<typeof SetupCheckPtyDrainedInputSchema>;
export type SetupCheckPtyDrainedResponse = z.infer<typeof SetupCheckPtyDrainedResponseSchema>;
