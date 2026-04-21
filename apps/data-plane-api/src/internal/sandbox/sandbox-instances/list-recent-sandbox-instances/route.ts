import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { ListRecentSandboxInstancesResponseSchema } from "../../../sandbox-instances/schemas.js";
import { InvalidListSandboxInstancesInputErrorCode } from "../../../sandbox-instances/services/list-sandbox-instances.js";
import { ListRecentSandboxInstancesQuerySchema } from "./schema.js";

const BadRequestResponseSchema = z.union([
  ValidationErrorResponseSchema,
  z
    .object({
      code: z.enum([InvalidListSandboxInstancesInputErrorCode]),
      message: z.string().min(1),
    })
    .strict(),
]);

export const route = createRoute({
  method: "get",
  path: "/instances/recent",
  tags: ["Internal"],
  request: {
    query: ListRecentSandboxInstancesQuerySchema,
  },
  responses: {
    200: {
      description: "List recent sandbox instances for internal callers.",
      content: {
        "application/json": {
          schema: ListRecentSandboxInstancesResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request query.",
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
