import { z } from "@hono/zod-openapi";
import { createCodeMessageErrorSchema } from "@mistle/http/errors.js";

import { DesignerConflictCodes, DesignerNotFoundCodes } from "../constants.js";

export const conflictResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    DesignerConflictCodes.DESIGNER_ACTION_PROPOSAL_NOT_PENDING,
    DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_NOT_READY,
    DesignerConflictCodes.DESIGNER_RUNTIME_CONVERSATION_BUSY,
  ]),
);

export const notFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    DesignerNotFoundCodes.DESIGNER_ACTION_PROPOSAL_NOT_FOUND,
    DesignerNotFoundCodes.DESIGNER_SESSION_NOT_FOUND,
  ]),
);
