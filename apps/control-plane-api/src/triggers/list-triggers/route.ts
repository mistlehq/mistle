import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { ListTriggersQuerySchema } from "../services/trigger-summaries.js";
import { ListTriggersBadRequestResponseSchema, ListTriggersResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Triggers"],
  request: {
    query: ListTriggersQuerySchema,
  },
  responses: {
    200: {
      description: "List triggers for the active organization.",
      content: {
        "application/json": {
          schema: ListTriggersResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListTriggersBadRequestResponseSchema,
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
