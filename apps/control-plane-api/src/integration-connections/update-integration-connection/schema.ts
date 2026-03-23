import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { IntegrationConnectionsNotFoundCodes } from "../constants.js";

export const UpdateIntegrationConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const UpdateIntegrationConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
  })
  .strict();

export const UpdateIntegrationConnectionBadRequestResponseSchema = ValidationErrorResponseSchema;

export const UpdateIntegrationConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND),
);
