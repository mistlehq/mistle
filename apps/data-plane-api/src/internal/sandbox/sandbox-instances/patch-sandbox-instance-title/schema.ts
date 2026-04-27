import { z } from "@hono/zod-openapi";
import { NotFoundResponseSchema } from "@mistle/http/errors.js";

import { PatchSandboxInstanceTitleResponseSchema } from "../../../sandbox-instances/patch-sandbox-instance-title/schema.js";

export const PatchSandboxInstanceTitleParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const PatchSandboxInstanceTitleBodySchema = z
  .object({
    onlyIfUnset: z.boolean().optional(),
    organizationId: z.string().min(1),
    title: z.string().trim().min(1),
  })
  .strict();

export { NotFoundResponseSchema, PatchSandboxInstanceTitleResponseSchema };
