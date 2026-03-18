import { createRoute, z } from "@hono/zod-openapi";
import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createKeysetPageSizeSchema,
  createKeysetPaginationEnvelopeSchema,
  createKeysetPaginationQuerySchema,
} from "@mistle/http/pagination";
import { IntegrationResourceSelectionModes } from "@mistle/integrations-core";

import { createRequireAuthSessionMiddleware } from "../middleware/require-auth-session.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsConflictCodes,
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
  IntegrationConnectionsBadRequestCodes.INVALID_LIST_CONNECTION_RESOURCES_INPUT,
  IntegrationConnectionsBadRequestCodes.INVALID_RESOURCE_PAGINATION_CURSOR,
  IntegrationConnectionsBadRequestCodes.RESOURCE_KIND_NOT_SUPPORTED,
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

export const IntegrationConnectionResourceSchema = z
  .object({
    id: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    externalId: z.string().min(1).optional(),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    status: z.enum([IntegrationConnectionResourceStatuses.ACCESSIBLE]),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export const ListIntegrationConnectionResourcesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
  })
  .strict();

export const RefreshIntegrationConnectionResourcesParamsSchema = z
  .object({
    connectionId: z.string().min(1),
    kind: z.string().min(1),
  })
  .strict();

export const ListIntegrationConnectionResourcesQuerySchema = z
  .object({
    kind: z.string().min(1),
    search: z.string().min(1).optional(),
    limit: z.preprocess(
      (rawValue) => {
        if (rawValue === undefined) {
          return undefined;
        }

        if (typeof rawValue === "number") {
          return rawValue;
        }

        if (typeof rawValue === "string") {
          return Number(rawValue);
        }

        return rawValue;
      },
      createKeysetPageSizeSchema({ defaultLimit: 20, maxLimit: 100 }),
    ),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => !(value.after !== undefined && value.before !== undefined), {
    message: "Only one of `after` or `before` can be provided.",
  });

export const ListIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.enum([
      IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      IntegrationConnectionResourceSyncStates.SYNCING,
      IntegrationConnectionResourceSyncStates.READY,
      IntegrationConnectionResourceSyncStates.ERROR,
    ]),
    lastSyncedAt: z.string().min(1).optional(),
    lastErrorCode: z.string().min(1).optional(),
    lastErrorMessage: z.string().min(1).optional(),
    items: z.array(IntegrationConnectionResourceSchema),
    page: z
      .object({
        totalResults: z.number().int().nonnegative(),
        nextCursor: z.string().min(1).nullable(),
        previousCursor: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

export const RefreshIntegrationConnectionResourcesResponseSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.literal(IntegrationConnectionResourceSyncStates.SYNCING),
  })
  .strict();

const ConflictCodeSchema = z.enum([
  IntegrationConnectionsConflictCodes.RESOURCE_SYNC_REQUIRED,
  IntegrationConnectionsConflictCodes.RESOURCE_SYNC_IN_PROGRESS,
  IntegrationConnectionsConflictCodes.RESOURCE_SYNC_FAILED,
]);

export const IntegrationConnectionsConflictResponseSchema = z
  .object({
    code: ConflictCodeSchema,
    message: z.string().min(1),
    lastErrorCode: z.string().min(1).optional(),
    lastErrorMessage: z.string().min(1).optional(),
  })
  .strict();

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

const RedirectLocationHeaderSchema = z
  .object({
    Location: z.string().min(1),
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
  })
  .strict();

export const UpdateApiKeyConnectionBodySchema = z
  .object({
    displayName: z.string().min(1),
    apiKey: z
      .string()
      .min(1)
      .regex(/\S/, "`apiKey` must contain at least one non-whitespace character when provided."),
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

export const CompleteOAuthConnectionQuerySchema = z
  .object({
    state: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    error_description: z.string().min(1).optional(),
    error_uri: z.string().min(1).optional(),
    installation_id: z.string().min(1).optional(),
    setup_action: z.string().min(1).optional(),
  })
  .catchall(z.string());

const ProtectedIntegrationConnectionsRouteMiddleware = [
  createRequireAuthSessionMiddleware(),
] satisfies [ReturnType<typeof createRequireAuthSessionMiddleware>];

export const listIntegrationConnectionsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
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

export const listIntegrationConnectionResourcesRoute = createRoute({
  method: "get",
  path: "/:connectionId/resources",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
  request: {
    params: ListIntegrationConnectionResourcesParamsSchema,
    query: ListIntegrationConnectionResourcesQuerySchema,
  },
  responses: {
    200: {
      description: "List resources exposed by an integration connection for a resource kind.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionResourcesResponseSchema,
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
    404: {
      description: "Integration connection was not found.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsNotFoundResponseSchema,
        },
      },
    },
    409: {
      description: "Resource listing requires a usable resource snapshot.",
      content: {
        "application/json": {
          schema: IntegrationConnectionsConflictResponseSchema,
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

export const refreshIntegrationConnectionResourcesRoute = createRoute({
  method: "post",
  path: "/:connectionId/resources/:kind/refresh",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
  request: {
    params: RefreshIntegrationConnectionResourcesParamsSchema,
  },
  responses: {
    202: {
      description: "Enqueue a resource sync for an integration connection resource kind.",
      content: {
        "application/json": {
          schema: RefreshIntegrationConnectionResourcesResponseSchema,
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
      description: "Integration connection was not found.",
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

export const createApiKeyConnectionRoute = createRoute({
  method: "post",
  path: "/:targetKey/api-key",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
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
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
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

export const updateApiKeyConnectionRoute = createRoute({
  method: "put",
  path: "/:connectionId/api-key",
  tags: ["Integrations"],
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
  request: {
    params: UpdateApiKeyConnectionParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateApiKeyConnectionBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Rotate the API key for an existing integration connection.",
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
  middleware: ProtectedIntegrationConnectionsRouteMiddleware,
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
  method: "get",
  path: "/:targetKey/oauth/complete",
  tags: ["Integrations"],
  request: {
    params: CompleteOAuthConnectionParamsSchema,
    query: CompleteOAuthConnectionQuerySchema,
  },
  responses: {
    302: {
      description: "Complete OAuth connection creation and redirect to dashboard integrations.",
      headers: RedirectLocationHeaderSchema,
    },
    400: {
      description: "Invalid request.",
      content: {
        "application/json": {
          schema: ListIntegrationConnectionsBadRequestResponseSchema,
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
