import { createRoute, z } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  designerSessionIdParamsSchema,
  prepareDesignerRuntimeProviderMcpInstallBodySchema,
  prepareDesignerRuntimeProviderMcpInstallResponseSchema,
} from "../schemas.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/sessions/{sessionId}/dashboard-actions/prepare-runtime-provider-mcp-install",
  tags: ["Designer"],
  request: {
    params: designerSessionIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: prepareDesignerRuntimeProviderMcpInstallBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Prepare a Designer runtime provider MCP installation action.",
      content: {
        "application/json": {
          schema: prepareDesignerRuntimeProviderMcpInstallResponseSchema,
        },
      },
    },
    400: {
      description: "Runtime provider MCP installation input is invalid.",
      content: {
        "application/json": {
          schema: badRequestResponseSchema,
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
      description: "Required organization permissions are missing.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Designer session, connection, or integration target was not found.",
      content: {
        "application/json": {
          schema: notFoundResponseSchema,
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
