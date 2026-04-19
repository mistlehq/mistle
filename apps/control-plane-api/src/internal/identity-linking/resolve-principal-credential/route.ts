import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { InternalIdentityLinkingErrorResponseSchema } from "../schemas.js";
import {
  ResolvePrincipalCredentialRequestSchema,
  ResolvePrincipalCredentialResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/resolve-principal-credential",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolvePrincipalCredentialRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve linked-principal credential for internal callers.",
      content: {
        "application/json": {
          schema: ResolvePrincipalCredentialResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid linked-principal credential resolve request.",
      content: {
        "application/json": {
          schema: InternalIdentityLinkingErrorResponseSchema,
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
      description: "Linked-principal credential dependency was not found.",
      content: {
        "application/json": {
          schema: InternalIdentityLinkingErrorResponseSchema,
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
