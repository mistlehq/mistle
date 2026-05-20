import { z } from "@hono/zod-openapi";

export { PutIdentityLinkProviderBodySchema as CreateIdentityLinkProviderConfigBodySchema } from "../put-identity-link-provider/schema.js";
export {
  PutIdentityLinkProviderBadRequestResponseSchema as CreateIdentityLinkProviderConfigBadRequestResponseSchema,
  PutIdentityLinkProviderNotFoundResponseSchema as CreateIdentityLinkProviderConfigNotFoundResponseSchema,
} from "../put-identity-link-provider/schema.js";

export const CreateIdentityLinkProviderConfigParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();
