import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsConflictCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const DeleteIntegrationConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const DeleteIntegrationConnectionResponseSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const DeleteIntegrationConnectionBadRequestResponseSchema = ValidationErrorResponseSchema;

export const DeleteIntegrationConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);

export const DeleteIntegrationConnectionConflictResponseSchema = createCodeMessageErrorSchema(
  z.union([
    z.literal(IntegrationConnectionsConflictCodes.CONNECTION_HAS_BINDINGS),
    z.literal(IntegrationConnectionsConflictCodes.CONNECTION_HAS_AUTOMATIONS),
  ]),
);
