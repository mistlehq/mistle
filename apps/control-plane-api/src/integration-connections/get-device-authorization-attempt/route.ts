import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  GetDeviceAuthorizationAttemptBadRequestResponseSchema,
  GetDeviceAuthorizationAttemptNotFoundResponseSchema,
  GetDeviceAuthorizationAttemptParamsSchema,
  GetDeviceAuthorizationAttemptResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:targetKey/device-authorization/attempts/:attemptId",
  tags: ["Integrations"],
  request: {
    params: GetDeviceAuthorizationAttemptParamsSchema,
  },
  responses: {
    200: {
      description: "Read the current state of a device authorization attempt.",
      content: {
        "application/json": {
          schema: GetDeviceAuthorizationAttemptResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: GetDeviceAuthorizationAttemptBadRequestResponseSchema,
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
      description: "Device authorization attempt was not found.",
      content: {
        "application/json": {
          schema: GetDeviceAuthorizationAttemptNotFoundResponseSchema,
        },
      },
    },
  },
});
