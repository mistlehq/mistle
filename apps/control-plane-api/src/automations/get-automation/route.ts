import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { AutomationParamsSchema } from "../schemas.js";
import {
  GetAutomationBadRequestResponseSchema,
  GetAutomationNotFoundResponseSchema,
  GetAutomationResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/{automationId}",
  tags: ["Automations"],
  request: {
    params: AutomationParamsSchema,
  },
  responses: {
    200: {
      description: "Get an automation summary.",
      content: {
        "application/json": {
          schema: GetAutomationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: GetAutomationBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Automation was not found.",
      content: {
        "application/json": {
          schema: GetAutomationNotFoundResponseSchema,
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
