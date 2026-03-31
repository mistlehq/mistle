import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const UpdateFormConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const UpdateFormConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    secrets: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const UpdateFormConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_REQUIRED,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const UpdateFormConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.enum([
    IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
    IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
  ]),
);
