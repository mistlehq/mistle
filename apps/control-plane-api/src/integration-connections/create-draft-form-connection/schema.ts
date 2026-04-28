import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const CreateDraftFormConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
    methodId: z.string().min(1),
  })
  .strict();

export const CreateDraftFormConnectionBodySchema = z
  .object({
    displayName: z.string().trim().min(1),
  })
  .strict();

export const CreateDraftFormConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const CreateDraftFormConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND),
);
