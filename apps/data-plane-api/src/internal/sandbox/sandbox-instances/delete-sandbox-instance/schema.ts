import { z } from "@hono/zod-openapi";

import { DeleteSandboxInstanceResponseSchema } from "../../../sandbox-instances/delete-sandbox-instance/schema.js";

export const DeleteSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const DeleteSandboxInstanceQuerySchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();

export { DeleteSandboxInstanceResponseSchema };
