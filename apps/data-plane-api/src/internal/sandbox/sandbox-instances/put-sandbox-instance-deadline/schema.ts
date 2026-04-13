import { z } from "@hono/zod-openapi";

function isCanonicalUtcIsoString(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export const PutSandboxInstanceDeadlineKindSchema = z.enum(["idle", "disconnect"]);

export const PutSandboxInstanceDeadlineParamsSchema = z
  .object({
    id: z.string().min(1),
    kind: PutSandboxInstanceDeadlineKindSchema,
  })
  .strict();

export const PutSandboxInstanceDeadlineBodySchema = z
  .object({
    ownerLeaseId: z.string().min(1),
    dueAt: z
      .string()
      .min(1)
      .refine(isCanonicalUtcIsoString, "dueAt must be a canonical UTC ISO 8601 string."),
  })
  .strict();

export const PutSandboxInstanceDeadlineAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    kind: PutSandboxInstanceDeadlineKindSchema,
    generation: z.number().int().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();
