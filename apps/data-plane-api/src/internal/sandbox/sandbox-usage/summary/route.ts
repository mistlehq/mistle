import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import { SandboxUsageSummaryInputSchema, SandboxUsageSummaryResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/usage/summary",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SandboxUsageSummaryInputSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Sandbox usage summary for an organization and bounded period.",
      content: {
        "application/json": {
          schema: SandboxUsageSummaryResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
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
