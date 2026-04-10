import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  CancelDeviceAuthorizationAttemptBadRequestResponseSchema,
  CancelDeviceAuthorizationAttemptNotFoundResponseSchema,
  CancelDeviceAuthorizationAttemptParamsSchema,
  CancelDeviceAuthorizationAttemptResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/:targetKey/device-authorization/attempts/:attemptId",
  tags: ["Integrations"],
  request: {
    params: CancelDeviceAuthorizationAttemptParamsSchema,
  },
  responses: {
    200: {
      description: "Cancel a device authorization attempt.",
      content: {
        "application/json": {
          schema: CancelDeviceAuthorizationAttemptResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CancelDeviceAuthorizationAttemptBadRequestResponseSchema,
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
          schema: CancelDeviceAuthorizationAttemptNotFoundResponseSchema,
        },
      },
    },
  },
});
