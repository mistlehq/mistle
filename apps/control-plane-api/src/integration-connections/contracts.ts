import { createRoute, z } from "@hono/zod-openapi";
import {
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";
import { IntegrationResourceSelectionModes } from "@mistle/integrations-core";

import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "./services/errors.js";

const IntegrationConnectionStatusSchema = z.enum([
  IntegrationConnectionStatuses.ACTIVE,
  IntegrationConnectionStatuses.ERROR,
  IntegrationConnectionStatuses.REVOKED,
]);

const IntegrationConnectionResourceSummarySchema = z
  .object({
    kind: z.string().min(1),
    selectionMode: z.enum([
      IntegrationResourceSelectionModes.SINGLE,
      IntegrationResourceSelectionModes.MULTI,
    ]),
    count: z.number().int().min(0),
    syncState: z.enum([
      IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      IntegrationConnectionResourceSyncStates.SYNCING,
      IntegrationConnectionResourceSyncStates.READY,
      IntegrationConnectionResourceSyncStates.ERROR,
    ]),
    lastSyncedAt: z.string().min(1).optional(),
  })
  .strict();

export const IntegrationConnectionSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    displayName: z.string().min(1),
    status: IntegrationConnectionStatusSchema,
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    resources: z.array(IntegrationConnectionResourceSummarySchema).optional(),
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
  IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
  IntegrationConnectionsBadRequestCodes.API_KEY_NOT_SUPPORTED,
  IntegrationConnectionsBadRequestCodes.API_KEY_CONNECTION_REQUIRED,
  IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_START_INPUT,
  IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_COMPLETE_INPUT,
  IntegrationConnectionsBadRequestCodes.OAUTH_NOT_SUPPORTED,
  IntegrationConnectionsBadRequestCodes.OAUTH_HANDLER_NOT_CONFIGURED,
  IntegrationConnectionsBadRequestCodes.OAUTH_STATE_INVALID,
  IntegrationConnectionsBadRequestCodes.OAUTH_STATE_EXPIRED,
  IntegrationConnectionsBadRequestCodes.OAUTH_STATE_ALREADY_USED,
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

const NotFoundCodeSchema = z.enum([
  IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
  IntegrationConnectionsNotFoundCodes.CONNECTION_NOT_FOUND,
]);

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
    displayName: z.string().min(1),
    apiKey: z.string().min(1),
  })
  .strict();

export const StartOAuthConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const StartOAuthConnectionBodySchema = z
  .object({
    displayName: z.string().min(1).optional(),
  })
  .strict();

export const UpdateApiKeyConnectionParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const UpdateIntegrationConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    apiKey: z
      .string()
      .min(1)
      .regex(/\S/, "`apiKey` must contain at least one non-whitespace character when provided.")
      .optional(),
  })
  .strict();

export const StartOAuthConnectionResponseSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export const CompleteOAuthConnectionParamsSchema = z
  .object({
    targetKey: z.string().min(1),
  })
  .strict();

export const CompleteOAuthConnectionBodySchema = z
  .object({
    query: z.record(z.string(), z.string()),
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

export const updateIntegrationConnectionRoute = createRoute({
  method: "put",
  path: "/:connectionId",
  tags: ["Integrations"],
  request: {
    params: UpdateApiKeyConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateIntegrationConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Update an existing integration connection.",
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
      description: "Integration target or connection was not found.",
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

export const startOAuthConnectionRoute = createRoute({
  method: "post",
  path: "/:targetKey/oauth/start",
  tags: ["Integrations"],
  request: {
    params: StartOAuthConnectionParamsSchema,
    body: {
      required: false,
      content: {
        "application/json": {
          schema: StartOAuthConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Create an OAuth authorization URL for an integration target.",
      content: {
        "application/json": {
          schema: StartOAuthConnectionResponseSchema,
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

export const completeOAuthConnectionRoute = createRoute({
  method: "post",
  path: "/:targetKey/oauth/complete",
  tags: ["Integrations"],
  request: {
    params: CompleteOAuthConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CompleteOAuthConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Create an OAuth-backed integration connection from callback query params.",
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
