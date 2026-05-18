import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerScheduleParamsSchema } from "../schemas.js";
import { DeleteTriggerScheduleResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/{triggerId}",
  tags: ["Triggers"],
  request: {
    params: TriggerScheduleParamsSchema,
  },
  responses: {
    200: {
      description: "Delete a scheduled trigger.",
      content: {
        "application/json": {
          schema: DeleteTriggerScheduleResponseSchema,
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
      description: "Scheduled trigger was not found.",
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
