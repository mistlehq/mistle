import { z } from "@hono/zod-openapi";

import { OrganizationUsageResponseSchema } from "../services/organization-usage-contract.js";

export const OrganizationUsageQuerySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict();

export { OrganizationUsageResponseSchema };
