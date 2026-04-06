import { createRoute, z } from "@hono/zod-openapi";
import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";

import {
  badRequestResponseSchema,
  notFoundResponseSchema,
  sourceParamsSchema,
} from "../ingest-integration-webhook/schema.js";
import { IngestIntegrationWebhookResponseSchema } from "../schemas.js";

const immediateResponseBodySchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

export const route = createRoute({
  method: "post",
  path: "/:targetKey/:endpointKey",
  tags: ["Integrations"],
  request: {
    params: sourceParamsSchema,
  },
  responses: {
    "2XX": {
      description:
        "Immediate integration-defined webhook response. Status code, headers, content type, and body are integration-specific and may include empty responses.",
      content: {
        "*/*": {
          schema: immediateResponseBodySchema,
        },
      },
    },
    204: {
      description: "Immediate integration-defined webhook response with no body.",
    },
    202: {
      description: "Webhook event accepted for processing.",
      content: {
        "application/json": {
          schema: IngestIntegrationWebhookResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid webhook request.",
      content: {
        "application/json": {
          schema: z.union([badRequestResponseSchema, ValidationErrorResponseSchema]),
        },
      },
    },
    404: {
      description: "Integration target, source, or connection was not found.",
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
