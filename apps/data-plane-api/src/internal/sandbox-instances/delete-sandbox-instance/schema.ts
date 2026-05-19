import { z } from "@hono/zod-openapi";

export const DeleteSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["deleted", "already_deleted"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();

export type DeleteSandboxInstanceResponse = z.infer<typeof DeleteSandboxInstanceResponseSchema>;
