import { z } from "@hono/zod-openapi";

export const OrganizationLogoParamsSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();
