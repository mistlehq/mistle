import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { TriggerParamsSchema } from "../schemas.js";
import { ListTriggerActivityQuerySchema } from "../services/trigger-activity.js";
import {
  ListTriggerActivityBadRequestResponseSchema,
  ListTriggerActivityNotFoundResponseSchema,
  ListTriggerActivityResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{triggerId}/activity",
  tags: ["Triggers"],
  request: {
    params: TriggerParamsSchema,
    query: ListTriggerActivityQuerySchema,
  },
  responses: {
    200: {
      description: "List recent trigger source activity.",
      content: {
        "application/json": {
          schema: ListTriggerActivityResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListTriggerActivityBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Trigger was not found.",
      content: {
        "application/json": {
          schema: ListTriggerActivityNotFoundResponseSchema,
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
