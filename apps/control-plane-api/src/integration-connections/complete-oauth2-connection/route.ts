import { createRoute } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../schemas.js";
import {
  CompleteOAuth2ConnectionBadRequestResponseSchema,
  CompleteOAuth2ConnectionNotFoundResponseSchema,
  CompleteOAuth2ConnectionParamsSchema,
  CompleteOAuth2ConnectionQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:targetKey/oauth2/complete",
  tags: ["Integrations"],
  request: {
    params: CompleteOAuth2ConnectionParamsSchema,
    query: CompleteOAuth2ConnectionQuerySchema,
  },
  responses: {
    302: {
      description: "Complete OAuth2 connection creation and redirect to dashboard integrations.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CompleteOAuth2ConnectionBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Integration target was not found.",
      content: {
        "application/json": {
          schema: CompleteOAuth2ConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
