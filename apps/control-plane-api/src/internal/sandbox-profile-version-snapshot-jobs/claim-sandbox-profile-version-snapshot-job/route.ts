import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  ClaimSandboxProfileVersionSnapshotJobParamsSchema,
  ClaimSandboxProfileVersionSnapshotJobRequestSchema,
  InternalSandboxProfileVersionSnapshotJobConflictResponseSchema,
  InternalSandboxProfileVersionSnapshotJobNotFoundResponseSchema,
  InternalSandboxProfileVersionSnapshotJobsBadRequestResponseSchema,
  SandboxProfileVersionSnapshotJobOkResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "post",
  path: "/{jobId}/claim",
  tags: ["Internal"],
  request: {
    params: ClaimSandboxProfileVersionSnapshotJobParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ClaimSandboxProfileVersionSnapshotJobRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Claim a queued snapshot job for workflow execution.",
      content: {
        "application/json": {
          schema: SandboxProfileVersionSnapshotJobOkResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid claim request.",
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
      description: "Snapshot job could not be claimed.",
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
