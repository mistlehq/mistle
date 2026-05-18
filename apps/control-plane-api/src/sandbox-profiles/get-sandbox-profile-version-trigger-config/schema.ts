import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { SandboxProfilesNotFoundCodes } from "../errors.js";

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
  ]),
);
