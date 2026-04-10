import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { IntegrationDeviceAuthorizationAttemptSchema } from "../schemas.js";

export const CancelDeviceAuthorizationAttemptParamsSchema = z
  .object({
    targetKey: z.string().min(1),
    attemptId: z.string().min(1),
  })
  .strict();

export const CancelDeviceAuthorizationAttemptResponseSchema =
  IntegrationDeviceAuthorizationAttemptSchema;

export const CancelDeviceAuthorizationAttemptBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.literal(IntegrationConnectionsBadRequestCodes.INVALID_DEVICE_AUTH_CANCEL_INPUT),
  ),
  ValidationErrorResponseSchema,
]);

export const CancelDeviceAuthorizationAttemptNotFoundResponseSchema = createCodeMessageErrorSchema(
  z.literal(IntegrationConnectionsNotFoundCodes.DEVICE_AUTH_ATTEMPT_NOT_FOUND),
);
