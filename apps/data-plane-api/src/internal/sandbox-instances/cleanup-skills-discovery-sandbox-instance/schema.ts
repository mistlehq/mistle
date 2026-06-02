import { z } from "@hono/zod-openapi";

export const CleanupSkillsDiscoverySandboxInstanceResponseSchema = z
  .object({
    status: z.enum([
      "accepted",
      "already_stopped",
      "already_terminal",
      "stopped_before_provider_start",
    ]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();

export type CleanupSkillsDiscoverySandboxInstanceResponse = z.infer<
  typeof CleanupSkillsDiscoverySandboxInstanceResponseSchema
>;
