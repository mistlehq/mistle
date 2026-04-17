import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { IdentityLinkingNotFoundCodes } from "../../identity-linking/constants.js";

export const DeleteIdentityLinkProviderParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const DeleteIdentityLinkProviderNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
    IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
  ]),
);
