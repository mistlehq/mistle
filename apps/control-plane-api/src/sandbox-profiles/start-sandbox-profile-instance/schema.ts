import { z } from "@hono/zod-openapi";
import {
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";

import {
  SandboxProfilesCompileErrorCodes,
  SandboxProfilesNotFoundCodes,
} from "../services/errors.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      SandboxProfilesCompileErrorCodes.AGENT_RUNTIME_REQUIRED,
      SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONNECTION_REFERENCE,
      SandboxProfilesCompileErrorCodes.INVALID_CONNECTION_TARGET_REFERENCE,
      SandboxProfilesCompileErrorCodes.CONNECTION_MISMATCH,
      SandboxProfilesCompileErrorCodes.TARGET_DISABLED,
      SandboxProfilesCompileErrorCodes.CONNECTION_NOT_ACTIVE,
      SandboxProfilesCompileErrorCodes.KIND_MISMATCH,
      SandboxProfilesCompileErrorCodes.INVALID_TARGET_CONFIG,
      SandboxProfilesCompileErrorCodes.INVALID_TARGET_SECRETS,
      SandboxProfilesCompileErrorCodes.INVALID_BINDING_CONFIG,
      SandboxProfilesCompileErrorCodes.ROUTE_CONFLICT,
      SandboxProfilesCompileErrorCodes.ARTIFACT_CONFLICT,
      SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_CONFLICT,
      SandboxProfilesCompileErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
  ]),
);
