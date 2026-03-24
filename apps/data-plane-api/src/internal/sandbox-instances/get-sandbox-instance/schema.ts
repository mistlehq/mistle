import { z } from "@hono/zod-openapi";

import { GetSandboxInstanceResponseSchema } from "../schemas.js";

export const GetSandboxInstanceInputSchema = z
  .object({
    organizationId: z.string().min(1),
    instanceId: z.string().min(1),
  })
  .strict();

export type GetSandboxInstanceInput = z.infer<typeof GetSandboxInstanceInputSchema>;
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
