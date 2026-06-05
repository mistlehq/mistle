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
import { PendingIntegrationDeviceAuthorizationAttemptSchema } from "../schemas.js";

export const StartDeviceAuthorizationConnectionReauthorizationParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const StartDeviceAuthorizationConnectionReauthorizationResponseSchema =
  PendingIntegrationDeviceAuthorizationAttemptSchema;

export const StartDeviceAuthorizationConnectionReauthorizationBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsBadRequestCodes.INVALID_DEVICE_AUTH_START_INPUT,
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_NOT_SUPPORTED,
      IntegrationConnectionsBadRequestCodes.DEVICE_AUTH_CAPABILITY_NOT_CONFIGURED,
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const StartDeviceAuthorizationConnectionReauthorizationNotFoundResponseSchema =
  createCodeMessageErrorSchema(
    z.enum([
      IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
    ]),
  );

export const StartDeviceAuthorizationConnectionReauthorizationConflictResponseSchema =
  createCodeMessageErrorSchema(
    z.literal(IntegrationConnectionsConflictCodes.CONNECTION_USED_BY_IDENTITY_LINKING),
  );
