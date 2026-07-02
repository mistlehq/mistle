import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  InternalSandboxRuntimeBadRequestResponseSchema,
  InternalSandboxRuntimeErrorResponseSchema,
} from "../schemas.js";
import {
  InternalSandboxRuntimeResolveDesignerRuntimeEgressRouteRequestSchema,
  InternalSandboxRuntimeResolveDesignerRuntimeEgressRouteResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-designer-runtime-egress-route",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeResolveDesignerRuntimeEgressRouteRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve a Designer runtime provider egress route for internal gateway callers.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeResolveDesignerRuntimeEgressRouteResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid Designer runtime egress route resolution request.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeBadRequestResponseSchema,
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
      description: "Designer runtime egress route resolution dependency was not found.",
      content: {
        "application/json": {
          schema: InternalSandboxRuntimeErrorResponseSchema,
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
