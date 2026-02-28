import { createRoute, z } from "@hono/zod-openapi";
import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "./services/errors.js";

const IntegrationConnectionStatusSchema = z.enum([
  IntegrationConnectionStatuses.ACTIVE,
  IntegrationConnectionStatuses.ERROR,
  IntegrationConnectionStatuses.REVOKED,
]);

export const IntegrationConnectionSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    status: IntegrationConnectionStatusSchema,
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const ValidationErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.looseObject({
      name: z.string().min(1),
      message: z.string().min(1),
    }),
  })
  .strict();

const BadRequestCodeSchema = z.enum([
  IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTIONS_INPUT,
  IntegrationConnectionsBadRequestCodes.INVALID_PAGINATION_CURSOR,
  IntegrationConnectionsBadRequestCodes.INVALID_CREATE_CONNECTION_INPUT,
]);

export const IntegrationConnectionsBadRequestResponseSchema = z
  .object({
    code: BadRequestCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const ListIntegrationConnectionsBadRequestResponseSchema = z.union([
  IntegrationConnectionsBadRequestResponseSchema,
  ValidationErrorResponseSchema,
]);

const NotFoundCodeSchema = z.enum([IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND]);

export const IntegrationConnectionsNotFoundResponseSchema = z
  .object({
    code: NotFoundCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export const ListIntegrationConnectionsQuerySchema = createKeysetPaginationQuerySchema({
  defaultLimit: 20,
  maxLimit: 100,
});

export const ListIntegrationConnectionsResponseSchema = createKeysetPaginationEnvelopeSchema(
  IntegrationConnectionSchema,
  {
    maxLimit: 100,
  },
);

export const IntegrationConnectionsUnauthorizedResponseSchema = z
  .object({
    code: z.literal("UNAUTHORIZED"),
    message: z.string().min(1),
  })
  .strict();

export const IntegrationConnectionsForbiddenResponseSchema = z
  .object({
    code: z.literal("ACTIVE_ORGANIZATION_REQUIRED"),
    message: z.string().min(1),
  })
  .strict();

export const CreateApiKeyConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CreateApiKeyConnectionBodySchema = z
  .object({
    apiKey: z.string().min(1),
  })
  .strict();

export const listIntegrationConnectionsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  request: {
    query: ListIntegrationConnectionsQuerySchema,
  },
  responses: {
    200: {
      description: "List integration connections for the authenticated organization.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionsResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionsBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsForbiddenResponseSchema,
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

export const createApiKeyConnectionRoute = createRoute({
  method: "post",
  path: "/:targetKey/api-key",
  tags: ["Integrations"],
  request: {
    params: CreateApiKeyConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateApiKeyConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create an API-key backed integration connection.",
      content: {
        "application/json": {
          schema: IntegrationConnectionSchema,
        },
      },
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionsBadRequestResponseSchema,
        },
      },
    },
    401: {
      description: "Authentication is required.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsUnauthorizedResponseSchema,
        },
      },
    },
    403: {
      description: "Active organization is required.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsForbiddenResponseSchema,
        },
      },
    },
    404: {
      description: "Integration target was not found.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsNotFoundResponseSchema,
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
