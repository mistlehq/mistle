import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { AutomationScheduleParamsSchema, AutomationScheduleSchema } from "../schemas.js";
import {
  UpdateAutomationScheduleBadRequestResponseSchema,
  UpdateAutomationScheduleBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "patch",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationScheduleParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateAutomationScheduleBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a scheduled automation.",
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
          schema: UpdateAutomationScheduleBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Scheduled automation was not found.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
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
