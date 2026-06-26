import { createRoute } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
  createCodeMessageErrorSchema,
} from "@mistle/http/errors.js";
import { z } from "zod";

import { TriggerSchedulesBadRequestCodes } from "../constants.js";
import { TriggerScheduleParamsSchema, TriggerScheduleSchema } from "../schemas.js";

const DuplicateTriggerScheduleBadRequestCodeSchema = z.enum([
  TriggerSchedulesBadRequestCodes.UNSUPPORTED_DUPLICATE_SCHEDULE_KIND,
]);

const DuplicateTriggerScheduleBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(DuplicateTriggerScheduleBadRequestCodeSchema),
  ValidationErrorResponseSchema,
]);

export const route = createRoute({
  method: "post",
  path: "/{triggerId}/duplicate",
  tags: ["Triggers"],
  request: {
    params: TriggerScheduleParamsSchema,
  },
  responses: {
    201: {
      description: "Duplicate a recurring scheduled trigger as disabled.",
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
          schema: DuplicateTriggerScheduleBadRequestResponseSchema,
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
