import { createRoute, z } from "@hono/zod-openapi";
import {
  createCodeMessageErrorSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { ListSandboxInstancesResponseSchema } from "../schemas.js";
import {
  InvalidListSandboxInstancesInputErrorCode,
  InvalidPaginationCursorErrorCode,
} from "../services/list-sandbox-instances.js";
import { ListSandboxInstancesInputSchema } from "./schema.js";

export const ListSandboxInstancesBadRequestResponseSchema = z.union([
  createCodeMessageErrorSchema(
    z.union([
      z.literal(InvalidListSandboxInstancesInputErrorCode),
      z.literal(InvalidPaginationCursorErrorCode),
    ]),
  ),
  ValidationErrorResponseSchema,
]);

export const route = createRoute({
  method: "post",
  path: "/list",
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
          schema: ListSandboxInstancesBadRequestResponseSchema,
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
