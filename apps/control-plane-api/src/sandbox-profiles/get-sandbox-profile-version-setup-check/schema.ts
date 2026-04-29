import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";
import { z } from "zod";

import { SandboxProfilesNotFoundCodes } from "../errors.js";

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
    SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
    "SETUP_CHECK_NOT_FOUND",
  ]),
);

export const badRequestResponseSchema = ValidationErrorResponseSchema;
