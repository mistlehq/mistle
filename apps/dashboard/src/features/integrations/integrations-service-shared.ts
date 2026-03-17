import { z } from "zod";

import { normalizeHttpApiError } from "../api/http-api-error.js";

export const KeysetPageSchema = z
  .object({
    after: z.string().min(1),
    limit: z.number().int().min(1),
  })
  .strict();

export const IntegrationTargetSchema = z
  .object({
    targetKey: z.string().min(1),
    familyId: z.string().min(1),
    variantId: z.string().min(1),
    enabled: z.boolean(),
    config: z.unknown(),
    displayName: z.string().min(1),
    description: z.string().min(1),
    logoKey: z.string().min(1).optional(),
    connectionMethods: z
      .array(
        z
          .object({
            id: z.enum(["api-key", "oauth2", "github-app-installation"]),
            label: z.string().min(1),
            kind: z.enum(["api-key", "oauth2", "redirect"]),
          })
          .strict(),
      )
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

export const IntegrationConnectionSchema = z
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
            lastErrorMessage: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const IntegrationConnectionResourceSchema = z
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

export const IntegrationConnectionResourcesPageSchema = z
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

export const RefreshedIntegrationConnectionResourcesSchema = z
  .object({
    connectionId: z.string().min(1),
    familyId: z.string().min(1),
    kind: z.string().min(1),
    syncState: z.literal("syncing"),
  })
  .strict();

export const IntegrationTargetsPageSchema = z
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

export const IntegrationConnectionsPageSchema = z
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

export const StartedOAuthConnectionSchema = z
  .object({
    authorizationUrl: z.url(),
  })
  .strict();

export type IntegrationTarget = z.infer<typeof IntegrationTargetSchema>;
export type IntegrationConnectionMethod = NonNullable<
  IntegrationTarget["connectionMethods"]
>[number];
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

export async function readJsonWithSchema<T>(input: {
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

export function wrapIntegrationsApiError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): IntegrationsApiError {
  return new IntegrationsApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}
