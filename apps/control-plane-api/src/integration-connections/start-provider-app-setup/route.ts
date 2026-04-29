import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  StartProviderAppSetupBadRequestResponseSchema,
  StartProviderAppSetupBodySchema,
  StartProviderAppSetupNotFoundResponseSchema,
  StartProviderAppSetupParamsSchema,
  StartedProviderAppSetupResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/setup/:routeSegment/start",
  tags: ["Integrations"],
  request: {
    params: StartProviderAppSetupParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: StartProviderAppSetupBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Start a provider app setup flow.",
      content: {
        "application/json": {
          schema: StartedProviderAppSetupResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: StartProviderAppSetupBadRequestResponseSchema,
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
          schema: StartProviderAppSetupNotFoundResponseSchema,
        },
      },
    },
  },
});
