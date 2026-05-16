import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { ListSandboxInstancesInputSchema } from "../../../sandbox-instances/list-sandbox-instances/schema.js";
import { ListSandboxInstancesResponseSchema } from "../../../sandbox-instances/schemas.js";
import { InvalidListSandboxInstancesInputErrorCode } from "../../../sandbox-instances/services/list-sandbox-instances.js";
import { InvalidPaginationCursorErrorCode } from "../../../sandbox-instances/services/list-sandbox-instances.js";

const BadRequestResponseSchema = z.union([
  ValidationErrorResponseSchema,
  z
    .object({
      code: z.enum([InvalidListSandboxInstancesInputErrorCode, InvalidPaginationCursorErrorCode]),
      message: z.string().min(1),
    })
    .strict(),
]);

export const route = createRoute({
  method: "post",
  path: "/instances/list",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ListSandboxInstancesInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "List sandbox instances for internal callers.",
      content: {
        "application/json": {
          schema: ListSandboxInstancesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: BadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Internal service authentication failed.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
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
