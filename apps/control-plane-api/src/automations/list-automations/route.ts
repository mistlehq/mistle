import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { ListAutomationsQuerySchema } from "../services/automation-summaries.js";
import {
  ListAutomationsBadRequestResponseSchema,
  ListAutomationsResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Automations"],
  request: {
    query: ListAutomationsQuerySchema,
  },
  responses: {
    200: {
      description: "List automations for the active organization.",
      content: {
        "application/json": {
          schema: ListAutomationsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListAutomationsBadRequestResponseSchema,
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
