import { z } from "@hono/zod-openapi";

export {
  ListIdentityLinkProviderLinksBadRequestResponseSchema as ListIdentityLinkProviderConfigLinksBadRequestResponseSchema,
  ListIdentityLinkProviderLinksNotFoundResponseSchema as ListIdentityLinkProviderConfigLinksNotFoundResponseSchema,
} from "../list-identity-link-provider-links/schema.js";

export const ListIdentityLinkProviderConfigLinksParamsSchema = z
  .object({
    organizationProviderConfigId: z.string().min(1),
  })
  .strict();
