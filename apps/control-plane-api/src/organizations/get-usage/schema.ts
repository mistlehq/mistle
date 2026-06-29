import { z } from "@hono/zod-openapi";

import { OrganizationUsageResponseSchema } from "../services/organization-usage-contract.js";

export const OrganizationUsageQuerySchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/u),
  })
  .strict();

export { OrganizationUsageResponseSchema };
