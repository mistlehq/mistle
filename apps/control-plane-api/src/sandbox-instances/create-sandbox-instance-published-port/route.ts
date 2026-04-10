import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { conflictResponseSchema } from "../create-sandbox-instance-connection-token/schema.js";
import {
  sandboxInstanceIdParamsSchema,
  sandboxInstancePortParamsSchema,
  sandboxInstancePublishedPortSchema,
  sandboxInstancesNotFoundResponseSchema,
} from "../schemas.js";

const bodySchema = z.object({}).strict();

export const route = createRoute({
  method: "post",
  path: "/{instanceId}/ports/{port}/publish",
  tags: ["Sandbox Instances"],
  request: {
    params: sandboxInstanceIdParamsSchema.extend(sandboxInstancePortParamsSchema.shape),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: bodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Issue a short-lived publish bootstrap token for one sandbox port.",
      content: {
        "application/json": {
          schema: sandboxInstancePublishedPortSchema,
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
    404: {
      description: "Sandbox instance was not found.",
      content: {
        "application/json": {
          schema: sandboxInstancesNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance is not publishable.",
      content: {
        "application/json": {
          schema: conflictResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
        },
      },
    },
  },
});
