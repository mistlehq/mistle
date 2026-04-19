import { z } from "@hono/zod-openapi";

export const ListIdentityLinkProviderLinksParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();
