import { z } from "@hono/zod-openapi";

import { SetupCheckPtyDrainedResponseSchema } from "../../../sandbox-instances/setup-check-pty-drained/schema.js";

export const SetupCheckPtyDrainedParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const SetupCheckPtyDrainedBodySchema = z
  .object({
    ownerLeaseId: z.string().min(1),
  })
  .strict();

export { SetupCheckPtyDrainedResponseSchema };
