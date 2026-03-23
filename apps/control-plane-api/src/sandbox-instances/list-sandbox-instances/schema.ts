import { z } from "@hono/zod-openapi";
import {
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";

import { SandboxInstancesBadRequestCodes } from "../constants.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.literal(SandboxInstancesBadRequestCodes.INVALID_LIST_INSTANCES_INPUT),
  ),
  ValidationErrorResponseSchema,
]);
