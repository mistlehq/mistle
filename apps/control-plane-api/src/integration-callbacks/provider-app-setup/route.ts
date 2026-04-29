import { createRoute } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../../integration-connections/schemas.js";
import {
  CompleteProviderAppSetupCallbackBadRequestResponseSchema,
  CompleteProviderAppSetupCallbackNotFoundResponseSchema,
  CompleteProviderAppSetupCallbackParamsSchema,
  CompleteProviderAppSetupCallbackQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/setup/:callbackRouteKey",
  tags: ["Integrations"],
  request: {
    params: CompleteProviderAppSetupCallbackParamsSchema,
    query: CompleteProviderAppSetupCallbackQuerySchema,
  },
  responses: {
    302: {
      description: "Complete a provider app setup callback and redirect to dashboard.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CompleteProviderAppSetupCallbackBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: CompleteProviderAppSetupCallbackNotFoundResponseSchema,
        },
      },
    },
  },
});
