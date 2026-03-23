import { z } from "@hono/zod-openapi";
import {
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";

import {
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesNotFoundCodes,
} from "../errors.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.union([
      z.literal(SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_REFERENCE),
      z.literal(
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONNECTION_REFERENCE,
      ),
    ]),
  ),
  z
    .object({
      code: z.literal(
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
      ),
      message: z.string().min(1),
      details: z
        .object({
          issues: z
            .array(
              z
                .object({
                  clientRef: z.string().min(1).optional(),
                  bindingIdOrDraftIndex: z.string().min(1),
                  validatorCode: z.string().min(1),
                  field: z.string().min(1),
                  safeMessage: z.string().min(1),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    })
    .strict(),
  ValidationErrorResponseSchema,
]);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
  ]),
);
