import { z } from "@hono/zod-openapi";

export const GetSandboxInstanceParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();

export const GetSandboxInstanceQuerySchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();
