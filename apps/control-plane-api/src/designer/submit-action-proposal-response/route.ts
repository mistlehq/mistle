import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import {
  designerActionProposalIdParamsSchema,
  submitDesignerActionProposalResponseBodySchema,
  submitDesignerActionProposalResponseResponseSchema,
} from "../schemas.js";
import { conflictResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/runtime-conversation/action-proposals/{proposalId}/responses",
  tags: ["Designer"],
  request: {
    params: designerActionProposalIdParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: submitDesignerActionProposalResponseBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Submit a Designer action proposal response to the runtime conversation.",
      content: {
        "application/json": {
          schema: submitDesignerActionProposalResponseResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Designer session or action proposal not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
        },
      },
    },
    409: {
      description:
        "Designer runtime conversation is not ready, is busy, or the action proposal is no longer pending.",
      content: {
        "application/json": {
          schema: conflictResponseSchema,
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
