import { createRoute, z } from "@hono/zod-openapi";
import {
  ForbiddenResponseSchema,
  NotFoundResponseSchema,
  UnauthorizedResponseSchema,
  ValidationErrorResponseSchema,
} from "@mistle/http/errors.js";

import { conflictResponseSchema } from "../../sandbox-instances/create-sandbox-instance-connection-token/schema.js";
import { redirectLocationHeaderSchema } from "../../sandbox-instances/schemas.js";
import {
  publicPortAccessLinkParamsSchema,
  publicPortAccessLinkRedeemResponseSchema,
} from "../schemas.js";

export const route = createRoute({
  method: "get",
  path: "/{slug}",
  tags: ["Public Port Access Links"],
  request: {
    params: publicPortAccessLinkParamsSchema,
  },
  responses: {
    200: {
      description: "Return the gateway bootstrap URL for a Port Access link.",
      content: {
        "application/json": {
          schema: publicPortAccessLinkRedeemResponseSchema,
        },
      },
    },
    302: {
      description: "Redirect to the gateway bootstrap endpoint for a Port Access link.",
      headers: redirectLocationHeaderSchema,
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
      description: "Unauthorized request.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization access is required.",
      content: {
        "application/json": {
          schema: ForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Port Access link was not found or has expired.",
      content: {
        "application/json": {
          schema: NotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Sandbox instance is not running.",
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
