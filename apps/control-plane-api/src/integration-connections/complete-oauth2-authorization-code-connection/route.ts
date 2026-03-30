import { createRoute } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../schemas.js";
import {
  CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema,
  CompleteOAuth2AuthorizationCodeConnectionNotFoundResponseSchema,
  CompleteOAuth2AuthorizationCodeConnectionParamsSchema,
  CompleteOAuth2AuthorizationCodeConnectionQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:targetKey/oauth2-authorization-code/complete",
  tags: ["Integrations"],
  request: {
    params: CompleteOAuth2AuthorizationCodeConnectionParamsSchema,
    query: CompleteOAuth2AuthorizationCodeConnectionQuerySchema,
  },
  responses: {
    302: {
      description:
        "Complete OAuth 2.0 (Authorization Code) connection creation and redirect to dashboard integrations.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Integration target was not found.",
      content: {
        "application/json": {
          schema: CompleteOAuth2AuthorizationCodeConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
