import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartExternalAppSetupBadRequestResponseSchema,
  StartExternalAppSetupBodySchema,
  StartExternalAppSetupNotFoundResponseSchema,
  StartExternalAppSetupParamsSchema,
  StartedExternalAppSetupResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/setup/:routeSegment/start",
  tags: ["Integrations"],
  request: {
    params: StartExternalAppSetupParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartExternalAppSetupBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Start an external app setup flow.",
      content: {
        "application/json": {
          schema: StartedExternalAppSetupResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartExternalAppSetupBadRequestResponseSchema,
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
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: StartExternalAppSetupNotFoundResponseSchema,
        },
      },
    },
  },
});
