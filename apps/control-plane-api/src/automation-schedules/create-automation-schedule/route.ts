import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { AutomationScheduleSchema } from "../schemas.js";
import {
  CreateAutomationScheduleBadRequestResponseSchema,
  CreateAutomationScheduleBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Automations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateAutomationScheduleBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a scheduled automation.",
      content: {
        "application/json": {
          schema: AutomationScheduleSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CreateAutomationScheduleBadRequestResponseSchema,
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
