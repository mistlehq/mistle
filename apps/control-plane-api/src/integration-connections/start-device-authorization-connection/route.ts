import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartDeviceAuthorizationConnectionBadRequestResponseSchema,
  StartDeviceAuthorizationConnectionBodySchema,
  StartDeviceAuthorizationConnectionNotFoundResponseSchema,
  StartDeviceAuthorizationConnectionParamsSchema,
  StartDeviceAuthorizationConnectionResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:targetKey/device-authorization/attempts",
  tags: ["Integrations"],
  request: {
    params: StartDeviceAuthorizationConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Start a device authorization attempt for an integration target.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionBadRequestResponseSchema,
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
      description: "Integration target was not found.",
      content: {
        "application/json": {
          schema: StartDeviceAuthorizationConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
