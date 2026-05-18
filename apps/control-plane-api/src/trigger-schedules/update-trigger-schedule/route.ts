import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
} from "@mistle/http/errors.js";

import { TriggerScheduleParamsSchema, TriggerScheduleSchema } from "../schemas.js";
import {
  UpdateTriggerScheduleBadRequestResponseSchema,
  UpdateTriggerScheduleBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "patch",
  path: "/{triggerId}",
  tags: ["Triggers"],
  request: {
    params: TriggerScheduleParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateTriggerScheduleBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update a scheduled trigger.",
      content: {
        "application/json": {
          schema: TriggerScheduleSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: UpdateTriggerScheduleBadRequestResponseSchema,
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
