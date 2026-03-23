import { z } from "@hono/zod-openapi";

export const GetMembershipCapabilitiesParamsSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();
