import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IdentityLinkingNotFoundCodes } from "../../identity-linking/constants.js";

export const DeleteLinkedAccountConfigParamsSchema = z
  .object({
    organizationProviderConfigId: z.string().min(1),
  })
  .strict();

export const DeleteLinkedAccountConfigValidationErrorResponseSchema = ValidationErrorResponseSchema;

export const DeleteLinkedAccountConfigNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND),
);
