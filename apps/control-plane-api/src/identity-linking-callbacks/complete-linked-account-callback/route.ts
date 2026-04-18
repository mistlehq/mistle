import { createRoute } from "@hono/zod-openapi";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  CompleteLinkedAccountCallbackParamsSchema,
  CompleteLinkedAccountCallbackQuerySchema,
  RedirectLocationHeaderSchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/:providerFamily",
  tags: ["Identity Linking"],
  request: {
    params: CompleteLinkedAccountCallbackParamsSchema,
    query: CompleteLinkedAccountCallbackQuerySchema,
  },
  responses: {
    302: {
      description:
        "Complete linked-account authorization and redirect back to dashboard profile settings.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid callback request.",
      content: {
        "application/json": {
          schema: ValidationErrorResponseSchema,
        },
      },
    },
  },
});
