import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import {
  SelectProviderAppSetupInstallationBadRequestResponseSchema,
  SelectProviderAppSetupInstallationBodySchema,
  SelectProviderAppSetupInstallationNotFoundResponseSchema,
  SelectProviderAppSetupInstallationParamsSchema,
  SelectedProviderAppSetupInstallationResponseSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/setup/:routeSegment/select-installation",
  tags: ["Integrations"],
  request: {
    params: SelectProviderAppSetupInstallationParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SelectProviderAppSetupInstallationBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Select a provider app installation and complete setup.",
      content: {
        "application/json": {
          schema: SelectedProviderAppSetupInstallationResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: SelectProviderAppSetupInstallationBadRequestResponseSchema,
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
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: SelectProviderAppSetupInstallationNotFoundResponseSchema,
        },
      },
    },
  },
});
