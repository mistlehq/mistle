import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { TriggerParamsSchema } from "../schemas.js";
import {
  GetTriggerBadRequestResponseSchema,
  GetTriggerNotFoundResponseSchema,
  GetTriggerResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{triggerId}",
  tags: ["Triggers"],
  request: {
    params: TriggerParamsSchema,
  },
  responses: {
    200: {
      description: "Get a trigger summary.",
      content: {
        "application/json": {
          schema: GetTriggerResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: GetTriggerBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Trigger was not found.",
      content: {
        "application/json": {
          schema: GetTriggerNotFoundResponseSchema,
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
  },
});
