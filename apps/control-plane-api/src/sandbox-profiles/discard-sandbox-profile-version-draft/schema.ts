import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { SandboxProfilesConflictCodes, SandboxProfilesNotFoundCodes } from "../errors.js";

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
  ]),
);

export const conflictResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesConflictCodes.DRAFT_ONLY_PROFILE_VERSION_CANNOT_BE_DISCARDED,
    SandboxProfilesConflictCodes.PROFILE_VERSION_ACTIVE,
    SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
  ]),
);
