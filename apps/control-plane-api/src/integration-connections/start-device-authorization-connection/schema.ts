import { z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";
import { PendingIntegrationDeviceAuthorizationAttemptSchema } from "../schemas.js";

export const StartDeviceAuthorizationConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const StartDeviceAuthorizationConnectionBodySchema = z
  .object({
    methodId: z.string().min(1),
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const StartDeviceAuthorizationConnectionResponseSchema =
  PendingIntegrationDeviceAuthorizationAttemptSchema;

export const StartDeviceAuthorizationConnectionBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_DEVICE_AUTH_START_INPUT,
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_CAPABILITY_NOT_CONFIGURED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartDeviceAuthorizationConnectionNotFoundResponseSchema =
  createCodeMessageErrorSchema(z.literal(IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND));
