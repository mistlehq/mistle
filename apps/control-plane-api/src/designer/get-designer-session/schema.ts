import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { DesignerNotFoundCodes } from "../constants.js";

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND),
);
