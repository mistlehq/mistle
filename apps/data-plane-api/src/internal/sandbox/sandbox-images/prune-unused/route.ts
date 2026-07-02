import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  PruneUnusedSandboxImagesAcceptedResponseSchema,
  PruneUnusedSandboxImagesRequestSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/images/prune-unused",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: PruneUnusedSandboxImagesRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Enqueue unused sandbox image pruning.",
      content: {
        "application/json": {
          schema: PruneUnusedSandboxImagesAcceptedResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body.",
      content: {
        "text/plain": {
          schema: z.string().min(1),
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
