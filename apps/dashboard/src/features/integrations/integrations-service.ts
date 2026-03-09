import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";
import { requestControlPlane } from "../api/request-control-plane.js";

const KeysetPageSchema = z
  .object({
    after: z.string().min(1),
    limit: z.number().int().min(1),
  })
  .strict();

const IntegrationTargetSchema = z
  .object({
    targetKey: z.string().min(1),
    familyId: z.string().min(1),
    variantId: z.string().min(1),
    enabled: z.boolean(),
    config: z.unknown(),
    displayName: z.string().min(1),
    description: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    supportedAuthSchemes: z
      .array(z.enum(["oauth", "api-key"]))
      .min(1)
      .optional(),
    displayNameOverride: z.string().min(1).optional(),
    descriptionOverride: z.string().min(1).optional(),
    targetHealth: z
      .object({
        configStatus: z.enum(["valid", "invalid"]),
      })
      .strict(),
  })
  .strict();

const IntegrationConnectionSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    displayName: z.string().min(1),
    status: z.enum(["active", "error", "revoked"]),
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    resources: z
      .array(
        z
          .object({
            kind: z.string().min(1),
            selectionMode: z.enum(["single", "multi"]),
            count: z.number().int().min(0),
            syncState: z.enum(["never-synced", "syncing", "ready", "error"]),
            lastSyncedAt: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const IntegrationConnectionResourceSchema = z
  .object({
    id: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    externalId: z.string().min(1).optional(),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    status: z.literal("accessible"),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

const IntegrationConnectionResourcesPageSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.enum(["never-synced", "syncing", "ready", "error"]),
    lastSyncedAt: z.string().min(1).optional(),
    lastErrorCode: z.string().min(1).optional(),
    lastErrorMessage: z.string().min(1).optional(),
    items: z.array(IntegrationConnectionResourceSchema),
    page: z
      .object({
        totalResults: z.number().int().min(0),
        nextCursor: z.string().min(1).nullable(),
        previousCursor: z.string().min(1).nullable(),
      })
      .strict(),
  })
  .strict();

const RefreshedIntegrationConnectionResourcesSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.literal("syncing"),
  })
  .strict();

const IntegrationTargetsPageSchema = z
  .object({
    items: z.array(IntegrationTargetSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: z
      .object({
        before: z.string().min(1),
        limit: z.number().int().min(1),
      })
      .strict()
      .nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

const IntegrationConnectionsPageSchema = z
  .object({
    items: z.array(IntegrationConnectionSchema),
    nextPage: KeysetPageSchema.nullable(),
    previousPage: z
      .object({
        before: z.string().min(1),
        limit: z.number().int().min(1),
      })
      .strict()
      .nullable(),
    totalResults: z.number().int().min(0),
  })
  .strict();

const StartedOAuthConnectionSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export type IntegrationTarget = z.infer<typeof IntegrationTargetSchema>;
export type IntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type IntegrationConnectionResourceSummary = NonNullable<
  IntegrationConnection["resources"]
>[number];
export type IntegrationConnectionResource = z.infer<typeof IntegrationConnectionResourceSchema>;
export type CreatedIntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type StartedOAuthConnection = z.infer<typeof StartedOAuthConnectionSchema>;
export type IntegrationConnectionResources = Omit<
  z.infer<typeof IntegrationConnectionResourcesPageSchema>,
  "items" | "page"
> & {
  items: readonly IntegrationConnectionResource[];
};
export type RefreshedIntegrationConnectionResources = z.infer<
  typeof RefreshedIntegrationConnectionResourcesSchema
>;

export class IntegrationsApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;
  readonly code: string | null;

  constructor(input: {
    operation: string;
    status: number;
    body: unknown;
    message: string;
    code?: string | null;
  }) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
    this.code = input.code ?? null;
  }
}

const INTEGRATIONS_PAGE_LIMIT = 100;

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);
  if (!parsed.success) {
    throw new IntegrationsApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: "Integration API response payload is invalid.",
    });
  }

  return parsed.data;
}

async function listAllIntegrationTargets(input: {
  signal?: AbortSignal;
}): Promise<readonly IntegrationTarget[]> {
  const items: IntegrationTarget[] = [];
  let after: string | null = null;

  for (;;) {
    const response = await requestControlPlane({
      operation: "listIntegrationTargets",
      method: "GET",
      pathname: "/v1/integration/targets",
      query: {
        limit: INTEGRATIONS_PAGE_LIMIT,
        ...(after === null ? {} : { after }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load integration targets.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: IntegrationTargetsPageSchema,
      operation: "listIntegrationTargets",
    });

    items.push(...data.items);
    if (data.nextPage === null) {
      return items;
    }

    after = data.nextPage.after;
  }
}

async function listAllIntegrationConnections(input: {
  signal?: AbortSignal;
}): Promise<readonly IntegrationConnection[]> {
  const items: IntegrationConnection[] = [];
  let after: string | null = null;

  for (;;) {
    const response = await requestControlPlane({
      operation: "listIntegrationConnections",
      method: "GET",
      pathname: "/v1/integration/connections",
      query: {
        limit: INTEGRATIONS_PAGE_LIMIT,
        ...(after === null ? {} : { after }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load integration connections.",
    });

    const data = await readJsonWithSchema({
      response,
      schema: IntegrationConnectionsPageSchema,
      operation: "listIntegrationConnections",
    });

    items.push(...data.items);
    if (data.nextPage === null) {
      return items;
    }

    after = data.nextPage.after;
  }
}

export async function listIntegrationDirectory(input: { signal?: AbortSignal }): Promise<{
  targets: readonly IntegrationTarget[];
  connections: readonly IntegrationConnection[];
}> {
  try {
    const [targets, connections] = await Promise.all([
      listAllIntegrationTargets(input.signal === undefined ? {} : { signal: input.signal }),
      listAllIntegrationConnections(input.signal === undefined ? {} : { signal: input.signal }),
    ]);

    return {
      targets,
      connections,
    };
  } catch (error) {
    throw new IntegrationsApiError(
      normalizeHttpApiError({
        operation: "listIntegrationDirectory",
        error,
        fallbackMessage: "Could not load integrations.",
      }),
    );
  }
}

const INTEGRATION_CONNECTION_RESOURCES_PAGE_LIMIT = 100;

export async function listIntegrationConnectionResources(input: {
  connectionId: string;
  kind: string;
  search?: string;
  signal?: AbortSignal;
}): Promise<IntegrationConnectionResources> {
  try {
    const items: IntegrationConnectionResource[] = [];
    let after: string | null = null;
    let responseMetadata: Omit<IntegrationConnectionResources, "items"> | null = null;

    for (;;) {
      const response = await requestControlPlane({
        operation: "listIntegrationConnectionResources",
        method: "GET",
        pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/resources`,
        query: {
          kind: input.kind,
          limit: INTEGRATION_CONNECTION_RESOURCES_PAGE_LIMIT,
          ...(input.search === undefined || input.search.length === 0
            ? {}
            : { search: input.search }),
          ...(after === null ? {} : { after }),
        },
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        fallbackMessage: "Could not load integration connection resources.",
      });

      const data = await readJsonWithSchema({
        response,
        schema: IntegrationConnectionResourcesPageSchema,
        operation: "listIntegrationConnectionResources",
      });

      items.push(...data.items);
      responseMetadata = {
        connectionId: data.connectionId,
        familyId: data.familyId,
        kind: data.kind,
        syncState: data.syncState,
        ...(data.lastSyncedAt === undefined ? {} : { lastSyncedAt: data.lastSyncedAt }),
        ...(data.lastErrorCode === undefined ? {} : { lastErrorCode: data.lastErrorCode }),
        ...(data.lastErrorMessage === undefined ? {} : { lastErrorMessage: data.lastErrorMessage }),
      };

      if (data.page.nextCursor === null) {
        if (responseMetadata === null) {
          throw new Error("Expected integration connection resources metadata to be present.");
        }

        return {
          ...responseMetadata,
          items,
        };
      }

      after = data.page.nextCursor;
    }
  } catch (error) {
    throw new IntegrationsApiError(
      normalizeHttpApiError({
        operation: "listIntegrationConnectionResources",
        error,
        fallbackMessage: "Could not load integration connection resources.",
      }),
    );
  }
}

export async function refreshIntegrationConnectionResources(input: {
  connectionId: string;
  kind: string;
}): Promise<RefreshedIntegrationConnectionResources> {
  try {
    const response = await requestControlPlane({
      operation: "refreshIntegrationConnectionResources",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/resources/${encodeURIComponent(input.kind)}/refresh`,
      fallbackMessage: "Could not refresh integration connection resources.",
    });

    return readJsonWithSchema({
      response,
      schema: RefreshedIntegrationConnectionResourcesSchema,
      operation: "refreshIntegrationConnectionResources",
    });
  } catch (error) {
    throw new IntegrationsApiError(
      normalizeHttpApiError({
        operation: "refreshIntegrationConnectionResources",
        error,
        fallbackMessage: "Could not refresh integration connection resources.",
      }),
    );
  }
}

export async function createApiKeyIntegrationConnection(input: {
  targetKey: string;
  displayName: string;
  apiKey: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "createApiKeyIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/api-key`,
      body: {
        displayName: input.displayName,
        apiKey: input.apiKey,
      },
      fallbackMessage: "Could not create integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "createApiKeyIntegrationConnection",
    });
  } catch (error) {
    throw new IntegrationsApiError(
      normalizeHttpApiError({
        operation: "createApiKeyIntegrationConnection",
        error,
        fallbackMessage: "Could not create integration connection.",
      }),
    );
  }
}

export async function updateIntegrationConnection(input: {
  connectionId: string;
  displayName: string;
  apiKey?: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "updateIntegrationConnection",
      method: "PUT",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.connectionId)}`,
      body: {
        displayName: input.displayName,
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      },
      fallbackMessage: "Could not update integration connection.",
    });

    return readJsonWithSchema({
      response,
      schema: IntegrationConnectionSchema,
      operation: "updateIntegrationConnection",
    });
  } catch (error) {
    throw new IntegrationsApiError(
      normalizeHttpApiError({
        operation: "updateIntegrationConnection",
        error,
        fallbackMessage: "Could not update integration connection.",
      }),
    );
  }
}

export async function startOAuthIntegrationConnection(input: {
  targetKey: string;
  displayName?: string;
}): Promise<StartedOAuthConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startOAuthIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/start`,
      ...(input.displayName === undefined ? {} : { body: { displayName: input.displayName } }),
      fallbackMessage: "Could not start OAuth connection.",
    });

    return readJsonWithSchema({
      response,
      schema: StartedOAuthConnectionSchema,
      operation: "startOAuthIntegrationConnection",
    });
  } catch (error) {
    throw new IntegrationsApiError(
      normalizeHttpApiError({
        operation: "startOAuthIntegrationConnection",
        error,
        fallbackMessage: "Could not start OAuth connection.",
      }),
    );
  }
}
