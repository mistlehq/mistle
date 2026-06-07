import { z } from "@hono/zod-openapi";
import {
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";

import { SandboxProfilesBadRequestCodes } from "../errors.js";

export const badRequestResponseSchema = z.union([
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema(
    z.enum([SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG]),
  ),
]);
