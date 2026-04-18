import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const UpdateIntegrationConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const UpdateIntegrationConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const UpdateIntegrationConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_REQUIRED,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const UpdateIntegrationConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
    IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
  ]),
);

export const UpdateIntegrationConnectionConflictResponseSchema = createCodeMessageErrorSchema(
  z.enum([IntegrationConnectionsConflictCodes.CONNECTION_USED_BY_IDENTITY_LINKING]),
);
