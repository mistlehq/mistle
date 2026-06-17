import { z } from "@hono/zod-openapi";
import {
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";

import { DesignerBadRequestCodes } from "../constants.js";

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.literal(DesignerBadRequestCodes.DESIGNER_SANDBOX_RUNTIME_UNAVAILABLE),
  ),
  ValidationErrorResponseSchema,
]);
