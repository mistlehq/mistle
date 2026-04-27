import { z } from "@hono/zod-openapi";

export const DeleteSandboxInstanceDeadlineKindSchema = z.enum(["idle", "disconnect"]);

export const DeleteSandboxInstanceDeadlineParamsSchema = z
  .object({
    id: z.string().min(1),
    kind: DeleteSandboxInstanceDeadlineKindSchema,
  })
  .strict();

export const DeleteSandboxInstanceDeadlineBodySchema = z
  .object({
    ownerLeaseId: z.string().min(1),
  })
  .strict();

export const DeleteSandboxInstanceDeadlineOkResponseSchema = z
  .object({
    status: z.literal("ok"),
    sandboxInstanceId: z.string().min(1),
    kind: DeleteSandboxInstanceDeadlineKindSchema,
  })
  .strict();
