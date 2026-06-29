import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { DesignerBadRequestCodes } from "../constants.js";

export { notFoundResponseSchema } from "../get-designer-session/schema.js";

const badRequestCodeSchema = z.literal(
  DesignerBadRequestCodes.DESIGNER_DASHBOARD_ACTION_INVALID_INPUT,
);

export const badRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(badRequestCodeSchema),
  ValidationErrorResponseSchema,
]);
