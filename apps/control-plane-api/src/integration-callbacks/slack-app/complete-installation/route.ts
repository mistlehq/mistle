import { createRoute } from "@hono/zod-openapi";

import { RedirectLocationHeaderSchema } from "../../../integration-connections/schemas.js";
import {
  CompleteSlackAppInstallationBadRequestResponseSchema,
  CompleteSlackAppInstallationNotFoundResponseSchema,
  CompleteSlackAppInstallationQuerySchema,
} from "./schema.js";

export const route = createRoute({
  method: "get",
  path: "/slack-app-installation",
  tags: ["Integrations"],
  request: {
    query: CompleteSlackAppInstallationQuerySchema,
  },
  responses: {
    302: {
      description: "Complete Slack app installation and redirect to dashboard setup.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: CompleteSlackAppInstallationBadRequestResponseSchema,
        },
      },
    },
    404: {
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: CompleteSlackAppInstallationNotFoundResponseSchema,
        },
      },
    },
  },
});
