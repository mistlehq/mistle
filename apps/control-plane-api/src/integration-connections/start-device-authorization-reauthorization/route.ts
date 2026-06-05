import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartDeviceAuthorizationConnectionReauthorizationBadRequestResponseSchema,
  StartDeviceAuthorizationConnectionReauthorizationConflictResponseSchema,
  StartDeviceAuthorizationConnectionReauthorizationNotFoundResponseSchema,
  StartDeviceAuthorizationConnectionReauthorizationParamsSchema,
  StartDeviceAuthorizationConnectionReauthorizationResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/device-authorization/reauthorize/start",
  tags: ["Integrations"],
  request: {
    params: StartDeviceAuthorizationConnectionReauthorizationParamsSchema,
  },
  responses: {
    200: {
      description:
        "Start a device authorization reauthorization attempt for an integration connection.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionReauthorizationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionReauthorizationBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Integration connection or target was not found.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionReauthorizationNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Integration connection cannot be reauthorized.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionReauthorizationConflictResponseSchema,
        },
      },
    },
  },
});
