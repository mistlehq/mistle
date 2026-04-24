import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { SandboxProfilesConflictCodes, SandboxProfilesNotFoundCodes } from "../errors.js";

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND),
);

export const conflictResponseSchema = createCodeMessageErrorSchema(
  z.literal(SandboxProfilesConflictCodes.DRAFT_ALREADY_EXISTS),
);
