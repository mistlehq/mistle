import { createRoute, z } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { InternalIntegrationCredentialErrorResponseSchema } from "../schemas.js";
import { InternalIntegrationCredentialsErrorCodes } from "../services/errors.js";
import {
  ResolveIntegrationCredentialRequestSchema,
  ResolveIntegrationCredentialResponseSchema,
} from "./schema.js";

const CredentialResolutionFailedResponseSchema = z
  .object({
    code: z.literal(InternalIntegrationCredentialsErrorCodes.CREDENTIAL_RESOLUTION_FAILED),
    message: z.string().min(1),
  })
  .strict();

export const route = createRoute({
  method: "post",
  path: "/resolve",
  tags: ["Internal"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: ResolveIntegrationCredentialRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Resolve integration credential for internal callers.",
      content: {
        "application/json": {
          schema: ResolveIntegrationCredentialResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid resolve request.",
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
    404: {
      description: "Credential resolver dependency was not found.",
      content: {
        "application/json": {
          schema: InternalIntegrationCredentialErrorResponseSchema,
        },
      },
    },
    502: {
      description: "Credential resolver dependency failed.",
      content: {
        "application/json": {
          schema: CredentialResolutionFailedResponseSchema,
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
