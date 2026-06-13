import { createRoute } from "@hono/zod-openapi";
import { ForbiddenResponseSchema, UnauthorizedResponseSchema } from "@mistle/http/errors.js";

import { IntegrationConnectionSchema } from "../schemas.js";
import {
  RepairIntegrationConnectionBadRequestResponseSchema,
  RepairIntegrationConnectionNotFoundResponseSchema,
  RepairIntegrationConnectionParamsSchema,
} from "./schema.js";

export const route = createRoute({
  method: "post",
  path: "/:connectionId/repair",
  tags: ["Integrations"],
  request: {
    params: RepairIntegrationConnectionParamsSchema,
  },
  responses: {
    200: {
      description: "Repair provider-owned metadata for an integration connection.",
      content: {
        "application/json": {
          schema: IntegrationConnectionSchema,
        },
      },
    },
    400: {
      description: "Repair is not supported or failed.",
      content: {
        "application/json": {
          schema: RepairIntegrationConnectionBadRequestResponseSchema,
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
          schema: RepairIntegrationConnectionNotFoundResponseSchema,
        },
      },
    },
  },
});
