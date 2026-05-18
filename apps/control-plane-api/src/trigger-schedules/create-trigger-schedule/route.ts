import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { TriggerScheduleSchema } from "../schemas.js";
import {
  CreateTriggerScheduleBadRequestResponseSchema,
  CreateTriggerScheduleBodySchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Triggers"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateTriggerScheduleBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create a scheduled trigger.",
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
          schema: CreateTriggerScheduleBadRequestResponseSchema,
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
