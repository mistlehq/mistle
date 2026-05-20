import { createRoute } from "@hono/zod-openapi";
import { UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  DeleteLinkedAccountConfigNotFoundResponseSchema,
  DeleteLinkedAccountConfigParamsSchema,
  DeleteLinkedAccountConfigValidationErrorResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "delete",
  path: "/linked-accounts/provider-configs/:organizationProviderConfigId",
  tags: ["Me"],
  request: {
    params: DeleteLinkedAccountConfigParamsSchema,
  },
  responses: {
    204: {
      description: "Unlink the authenticated user's linked account for the given provider config.",
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: UnauthorizedResponseSchema,
        },
      },
    },
    404: {
      description: "Provider config was not found.",
      content: {
        "application/json": {
          schema: DeleteLinkedAccountConfigNotFoundResponseSchema,
        },
      },
    },
    422: {
      description: "Validation error.",
      content: {
        "application/json": {
          schema: DeleteLinkedAccountConfigValidationErrorResponseSchema,
        },
      },
    },
  },
});
