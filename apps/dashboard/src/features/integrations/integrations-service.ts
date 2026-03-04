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
    displayNameOverride: z.string().min(1).optional(),
    descriptionOverride: z.string().min(1).optional(),
    targetHealth: z
      .object({
        configStatus: z.enum(["valid", "invalid"]),
      })
      .strict(),
    resolvedBindingUi: z
      .object({
        openaiAgent: z
          .object({
            kind: z.literal("agent"),
            runtime: z.literal("codex-cli"),
            familyId: z.literal("openai"),
            variantId: z.literal("openai-default"),
            byAuthScheme: z.record(
              z.enum(["api-key", "oauth"]),
              z
                .object({
                  models: z.array(z.string().min(1)),
                  allowedReasoningByModel: z.record(
                    z.string().min(1),
                    z.array(z.enum(["low", "medium", "high", "xhigh"])).min(1),
                  ),
                  defaultReasoningByModel: z.record(
                    z.string().min(1),
                    z.enum(["low", "medium", "high", "xhigh"]),
                  ),
                  reasoningLabels: z.record(
                    z.enum(["low", "medium", "high", "xhigh"]),
                    z.string().min(1),
                  ),
                })
                .strict(),
            ),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const IntegrationConnectionSchema = z
  .object({
    id: z.string().min(1),
    targetKey: z.string().min(1),
    status: z.enum(["active", "error", "revoked"]),
    externalSubjectId: z.string().min(1).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    targetSnapshotConfig: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
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
export type CreatedIntegrationConnection = z.infer<typeof IntegrationConnectionSchema>;
export type StartedOAuthConnection = z.infer<typeof StartedOAuthConnectionSchema>;

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

export async function createApiKeyIntegrationConnection(input: {
  targetKey: string;
  apiKey: string;
}): Promise<CreatedIntegrationConnection> {
  try {
    const response = await requestControlPlane({
      operation: "createApiKeyIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/api-key`,
      body: {
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

export async function startOAuthIntegrationConnection(input: {
  targetKey: string;
}): Promise<StartedOAuthConnection> {
  try {
    const response = await requestControlPlane({
      operation: "startOAuthIntegrationConnection",
      method: "POST",
      pathname: `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/oauth/start`,
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
