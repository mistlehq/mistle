import { z } from "@hono/zod-openapi";

import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesConflictCodes,
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesNotFoundCodes,
} from "../errors.js";

export const badRequestResponseSchema = z
  .object({
    code: z.enum([
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_REFERENCE,
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONNECTION_REFERENCE,
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE,
      SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG,
    ]),
    message: z.string().min(1),
    details: z
      .object({
        issues: z.array(
          z
            .object({
              clientRef: z.string().min(1).optional(),
              bindingIdOrDraftIndex: z.string().min(1),
              validatorCode: z.string().min(1),
              field: z.string().min(1),
              safeMessage: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict()
      .optional(),
  })
  .strict();

export const conflictResponseSchema = z
  .object({
    code: z.enum([SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT]),
    message: z.string().min(1),
  })
  .strict();

export const notFoundResponseSchema = z
  .object({
    code: z.enum([
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
    ]),
    message: z.string().min(1),
  })
  .strict();
