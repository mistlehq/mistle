import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IdentityLinkingBadRequestCodes } from "../../identity-linking/constants.js";

export const DeleteLinkedAccountParamsSchema = z
  .object({
    providerFamily: z.string().min(1),
  })
  .strict();

export const DeleteLinkedAccountValidationErrorResponseSchema = ValidationErrorResponseSchema;

export const DeleteLinkedAccountBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(z.literal(IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS)),
  ValidationErrorResponseSchema,
]);
