import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { InternalIntegrationCredentialErrorResponseSchema } from "../schemas.js";
import {
  ResolveIntegrationTargetSecretsRequestSchema,
  ResolveIntegrationTargetSecretsResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-target-secrets",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveIntegrationTargetSecretsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve integration target secrets for internal callers.",
      content: {
        "application/json": {
          schema: ResolveIntegrationTargetSecretsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid target secret resolution request.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialErrorResponseSchema,
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
