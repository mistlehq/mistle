import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  MaterializeSandboxProfileVersionSnapshotJobAcceptedResponseSchema,
  MaterializeSandboxProfileVersionSnapshotJobRequestSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/profile-version-snapshot-jobs/materialize",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: MaterializeSandboxProfileVersionSnapshotJobRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Enqueue snapshot materialization for a sandbox profile version snapshot job.",
      content: {
        "application/json": {
          schema: MaterializeSandboxProfileVersionSnapshotJobAcceptedResponseSchema,
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
