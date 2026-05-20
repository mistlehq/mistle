import { z } from "@hono/zod-openapi";

import { OrganizationIdentityLinkProviderConfigStatusSchema } from "../schemas.js";

export {
  PutIdentityLinkProviderBadRequestResponseSchema as CreateIdentityLinkProviderConfigBadRequestResponseSchema,
  PutIdentityLinkProviderNotFoundResponseSchema as CreateIdentityLinkProviderConfigNotFoundResponseSchema,
} from "../put-identity-link-provider/schema.js";

export const CreateIdentityLinkProviderConfigBodySchema = z
  .object({
    integrationConnectionId: z.string().min(1),
    status: OrganizationIdentityLinkProviderConfigStatusSchema,
  })
  .strict();

export const CreateIdentityLinkProviderConfigParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();
