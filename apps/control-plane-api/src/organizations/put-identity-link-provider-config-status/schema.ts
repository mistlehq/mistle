import { z } from "@hono/zod-openapi";

export {
  PutIdentityLinkProviderStatusBadRequestResponseSchema as PutIdentityLinkProviderConfigStatusBadRequestResponseSchema,
  PutIdentityLinkProviderStatusBodySchema as PutIdentityLinkProviderConfigStatusBodySchema,
  PutIdentityLinkProviderStatusNotFoundResponseSchema as PutIdentityLinkProviderConfigStatusNotFoundResponseSchema,
} from "../put-identity-link-provider-status/schema.js";

export const PutIdentityLinkProviderConfigStatusParamsSchema = z
  .object({
    organizationProviderConfigId: z.string().min(1),
  })
  .strict();
