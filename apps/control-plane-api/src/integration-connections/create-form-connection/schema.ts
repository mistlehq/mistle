import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

export const CreateFormConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CreateFormConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    methodId: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    secret: z
      .string()
      .min(1)
      .regex(/\S/, "`secret` must contain at least one non-whitespace character."),
  })
  .strict();

export const CreateFormConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
      IntegrationConnectionsBadRequestCodes.FORM_CONNECTION_METHOD_NOT_SUPPORTED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const CreateFormConnectionNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND),
);
