import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import {
  DesignerBadRequestCodes,
  DesignerConflictCodes,
  DesignerNotFoundCodes,
} from "../constants.js";

export const badRequestResponseSchema = createCodeMessageErrorSchema(
  z.enum([DesignerBadRequestCodes.DESIGNER_USER_INPUT_REQUEST_RESPONSE_INVALID]),
);

export const conflictResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_NOT_READY,
    DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_BUSY,
    DesignerConflictCodes.DESIGNER_USER_INPUT_REQUEST_NOT_PENDING,
  ]),
);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND]),
);
