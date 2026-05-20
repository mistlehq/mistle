import { z } from "@hono/zod-openapi";

export {
  DeleteIdentityLinkProviderBadRequestResponseSchema as DeleteIdentityLinkProviderConfigBadRequestResponseSchema,
  DeleteIdentityLinkProviderNotFoundResponseSchema as DeleteIdentityLinkProviderConfigNotFoundResponseSchema,
} from "../delete-identity-link-provider/schema.js";

export const DeleteIdentityLinkProviderConfigParamsSchema = z
  .object({
    organizationProviderConfigId: z.string().min(1),
  })
  .strict();
