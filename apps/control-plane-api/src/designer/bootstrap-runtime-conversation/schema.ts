import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { DesignerBadRequestCodes, DesignerNotFoundCodes } from "../constants.js";

export const conflictResponseSchema = createCodeMessageErrorSchema(z.string().min(1));

export const badRequestResponseSchema = createCodeMessageErrorSchema(
  z.literal(DesignerBadRequestCodes.DESIGNER_INITIAL_PROMPT_MISSING),
);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND),
);
