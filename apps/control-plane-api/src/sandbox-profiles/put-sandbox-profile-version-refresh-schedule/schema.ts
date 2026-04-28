import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { SandboxProfilesBadRequestCodes, SandboxProfilesNotFoundCodes } from "../errors.js";

export const badRequestResponseSchema = createCodeMessageErrorSchema(
  z.literal(SandboxProfilesBadRequestCodes.INVALID_REFRESH_SCHEDULE),
);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
  ]),
);
