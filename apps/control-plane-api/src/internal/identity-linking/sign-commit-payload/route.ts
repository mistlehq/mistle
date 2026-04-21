import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { InternalIdentityLinkingErrorResponseSchema } from "../schemas.js";
import { SignCommitPayloadRequestSchema, SignCommitPayloadResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sign-commit-payload",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SignCommitPayloadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Sign a Git commit payload for a linked-principal credential.",
      content: {
        "application/json": {
          schema: SignCommitPayloadResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid linked-principal commit signing request.",
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
      description: "Linked-principal signing dependency was not found.",
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
