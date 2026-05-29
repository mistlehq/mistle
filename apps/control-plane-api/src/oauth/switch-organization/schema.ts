import { z } from "@hono/zod-openapi";

export const OAuthSwitchOrganizationRequestSchema = z
  .object({
    organizationId: z.string().min(1),
  })
  .strict();
