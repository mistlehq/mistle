import { z } from "@hono/zod-openapi";
import {
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";

import { SandboxProfilesBadRequestCodes } from "../errors.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      SandboxProfilesBadRequestCodes.INVALID_LIST_PROFILES_INPUT,
      SandboxProfilesBadRequestCodes.INVALID_PAGINATION_CURSOR,
    ]),
  ),
  ValidationErrorResponseSchema,
]);
