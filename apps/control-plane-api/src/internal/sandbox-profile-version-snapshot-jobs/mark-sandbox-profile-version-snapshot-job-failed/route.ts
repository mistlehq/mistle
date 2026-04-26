import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxProfileVersionSnapshotJobConflictResponseSchema,
  InternalSandboxProfileVersionSnapshotJobNotFoundResponseSchema,
  InternalSandboxProfileVersionSnapshotJobsBadRequestResponseSchema,
  MarkSandboxProfileVersionSnapshotJobFailedRequestSchema,
  SandboxProfileVersionSnapshotJobParamsSchema,
  SandboxProfileVersionSnapshotJobOkResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/{jobId}/fail",
  tags: ["Internal"],
  request: {
    params: SandboxProfileVersionSnapshotJobParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: MarkSandboxProfileVersionSnapshotJobFailedRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Mark a running snapshot job failed.",
      content: {
        "application/json": {
          schema: SandboxProfileVersionSnapshotJobOkResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid failure request.",
      content: {
        "application/json": {
          schema: InternalSandboxProfileVersionSnapshotJobsBadRequestResponseSchema,
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
    404: {
      description: "Snapshot job was not found.",
      content: {
        "application/json": {
          schema: InternalSandboxProfileVersionSnapshotJobNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Snapshot job could not be marked failed.",
      content: {
        "application/json": {
          schema: InternalSandboxProfileVersionSnapshotJobConflictResponseSchema,
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
