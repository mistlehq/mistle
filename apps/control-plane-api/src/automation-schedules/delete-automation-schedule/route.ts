import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { AutomationScheduleParamsSchema } from "../schemas.js";
import { DeleteAutomationScheduleResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationScheduleParamsSchema,
  },
  responses: {
    200: {
      description: "Delete a scheduled automation.",
      content: {
        "application/json": {
          schema: DeleteAutomationScheduleResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
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
