import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { IdentityLinkingNotFoundCodes } from "../../identity-linking/constants.js";

export {
  PutIdentityLinkProviderBadRequestResponseSchema as PutIdentityLinkProviderConfigBadRequestResponseSchema,
  PutIdentityLinkProviderBodySchema as PutIdentityLinkProviderConfigBodySchema,
} from "../put-identity-link-provider/schema.js";

export const PutIdentityLinkProviderConfigParamsSchema = z
  .object({
    organizationProviderConfigId: z.string().min(1),
  })
  .strict();

export const PutIdentityLinkProviderConfigNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
    IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
    IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND,
  ]),
);
