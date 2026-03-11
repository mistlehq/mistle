import {
  integrationConnectionResources,
  integrationConnectionResourceStates,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type {
  AnyIntegrationDefinition,
  DiscoveredIntegrationResource,
  IntegrationConnection,
  IntegrationResourceCredentialRef,
  IntegrationResolvedTarget,
  ListConnectionResourcesInput,
  ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import { eq, inArray, sql } from "drizzle-orm";
import { defineWorkflow } from "openworkflow";
import { z } from "zod";

import { resolveIntegrationTargetSecrets } from "../src/integration-targets/services/resolve-target-secrets.js";
import { resolveIntegrationCredential } from "../src/internal-integration-credentials/services/resolve-credential.js";
import { getWorkflowContext } from "./context.js";

export type SyncIntegrationConnectionResourcesWorkflowInput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

export type SyncIntegrationConnectionResourcesWorkflowOutput = {
  organizationId: string;
  connectionId: string;
  kind: string;
};

type ResolveResourceSyncCredentialOutput = {
  value: string;
  expiresAt?: string;
};

type ResolveResourceSyncTargetSecretsOutput = {
  secrets: Record<string, string>;
};

type WorkflowIntegrationsConfig = Awaited<
  ReturnType<typeof getWorkflowContext>
>["integrationsConfig"];

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());
const DiscoveredIntegrationResourceSchema = z
  .object({
    externalId: z.string().min(1).optional(),
    handle: z.string().min(1),
    displayName: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

async function syncIntegrationConnectionResources(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: Awaited<ReturnType<typeof getWorkflowContext>>["integrationRegistry"];
  integrationsConfig: WorkflowIntegrationsConfig;
  workflowInput: SyncIntegrationConnectionResourcesWorkflowInput;
}): Promise<SyncIntegrationConnectionResourcesWorkflowOutput> {
  const connection = await input.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
      targetKey: true,
      status: true,
      externalSubjectId: true,
      config: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.workflowInput.connectionId),
    with: {
      target: {
        columns: {
          targetKey: true,
          familyId: true,
          variantId: true,
          enabled: true,
          config: true,
          secrets: true,
        },
      },
    },
  });

  if (connection === undefined) {
    throw new Error(`Integration connection '${input.workflowInput.connectionId}' was not found.`);
  }

  const target = connection.target;
  if (target === null) {
    throw new Error("Expected integration connection target relation to be present.");
  }

  if (connection.organizationId !== input.workflowInput.organizationId) {
    throw new Error(
      `Integration connection '${input.workflowInput.connectionId}' does not belong to organization '${input.workflowInput.organizationId}'.`,
    );
  }

  try {
    if (connection.status !== IntegrationConnectionStatuses.ACTIVE) {
      throw new Error(`Integration connection '${connection.id}' is not active.`);
    }
    if (!target.enabled) {
      throw new Error(`Integration target '${target.targetKey}' is disabled.`);
    }

    await markResourceSyncing({
      db: input.db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.workflowInput.kind,
    });

    const definition = input.integrationRegistry.getDefinition({
      familyId: target.familyId,
      variantId: target.variantId,
    });
    if (definition === undefined) {
      throw new Error(
        `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
      );
    }

    const resourceDefinition = findResourceDefinition(definition, input.workflowInput.kind);
    if (resourceDefinition === undefined) {
      throw new Error(
        `Resource kind '${input.workflowInput.kind}' is not declared for '${target.familyId}::${target.variantId}'.`,
      );
    }
    if (!hasListConnectionResources(definition)) {
      throw new Error(
        `Integration definition '${target.familyId}::${target.variantId}' does not implement resource listing.`,
      );
    }

    const parsedTargetConfig = parseUnknownRecord({
      label: `target config '${target.targetKey}'`,
      value: definition.targetConfigSchema.parse(target.config),
    });
    const resolvedTargetSecrets = resolveTargetSecrets({
      integrationsConfig: input.integrationsConfig,
      targetKey: target.targetKey,
      encryptedSecrets: target.secrets,
    });
    const parsedTargetSecrets = parseStringRecord({
      label: `target secrets '${target.targetKey}'`,
      value: definition.targetSecretSchema.parse(resolvedTargetSecrets.secrets),
    });
    const parsedConnectionConfig = parseUnknownRecord({
      label: `connection config '${connection.id}'`,
      value:
        definition.connectionConfigSchema === undefined
          ? (connection.config ?? {})
          : definition.connectionConfigSchema.parse(connection.config ?? {}),
    });
    const resolvedCredential = await resolveResourceCredential({
      db: input.db,
      integrationRegistry: input.integrationRegistry,
      integrationsConfig: input.integrationsConfig,
      connection: {
        id: connection.id,
        status: connection.status,
        ...(connection.externalSubjectId === null
          ? {}
          : { externalSubjectId: connection.externalSubjectId }),
        config: parsedConnectionConfig,
      },
      kind: input.workflowInput.kind,
      credential: resourceDefinition.credential,
    });

    const listedResources = await definition.listConnectionResources({
      organizationId: input.workflowInput.organizationId,
      targetKey: target.targetKey,
      target: {
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: target.enabled,
        config: parsedTargetConfig,
        secrets: parsedTargetSecrets,
      } satisfies IntegrationResolvedTarget,
      connection: {
        id: connection.id,
        status: connection.status,
        ...(connection.externalSubjectId === null
          ? {}
          : { externalSubjectId: connection.externalSubjectId }),
        config: parsedConnectionConfig,
      },
      kind: input.workflowInput.kind,
      ...(resolvedCredential === undefined ? {} : { credential: resolvedCredential }),
    });

    const discoveredResources = validateDiscoveredResources(listedResources.resources);

    await applySuccessfulResourceSync({
      db: input.db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.workflowInput.kind,
      discoveredResources,
    });
  } catch (error) {
    await markResourceSyncError({
      db: input.db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.workflowInput.kind,
      failure: resolveResourceSyncFailure(error),
    });
    throw error;
  }

  return {
    organizationId: input.workflowInput.organizationId,
    connectionId: input.workflowInput.connectionId,
    kind: input.workflowInput.kind,
  };
}

function findResourceDefinition(
  definition: AnyIntegrationDefinition,
  kind: string,
): NonNullable<AnyIntegrationDefinition["resourceDefinitions"]>[number] | undefined {
  return definition.resourceDefinitions?.find((candidate) => candidate.kind === kind);
}

function hasListConnectionResources(
  definition: AnyIntegrationDefinition,
): definition is AnyIntegrationDefinition & {
  listConnectionResources(
    input: ListConnectionResourcesInput,
  ): Promise<ListConnectionResourcesResult> | ListConnectionResourcesResult;
} {
  return (
    "listConnectionResources" in definition &&
    typeof definition.listConnectionResources === "function"
  );
}

function parseUnknownRecord(input: { label: string; value: unknown }): Record<string, unknown> {
  const parsed = UnknownRecordSchema.safeParse(input.value);
  if (!parsed.success) {
    throw new Error(`Expected ${input.label} to be a record.`);
  }

  return parsed.data;
}

function parseStringRecord(input: { label: string; value: unknown }): Record<string, string> {
  const parsed = StringRecordSchema.safeParse(input.value);
  if (!parsed.success) {
    throw new Error(`Expected ${input.label} to be a string record.`);
  }

  return parsed.data;
}

function resolveTargetSecrets(input: {
  integrationsConfig: WorkflowIntegrationsConfig;
  targetKey: string;
  encryptedSecrets: {
    ciphertext: string;
    nonce: string;
    masterKeyVersion: number;
  } | null;
}): ResolveResourceSyncTargetSecretsOutput {
  return {
    secrets: resolveIntegrationTargetSecrets({
      integrationsConfig: input.integrationsConfig,
      target: {
        targetKey: input.targetKey,
        secrets: input.encryptedSecrets,
      },
    }),
  };
}

async function resolveResourceCredential(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: Awaited<ReturnType<typeof getWorkflowContext>>["integrationRegistry"];
  integrationsConfig: WorkflowIntegrationsConfig;
  connection: IntegrationConnection;
  kind: string;
  credential:
    | IntegrationResourceCredentialRef
    | ((input: {
        connection: IntegrationConnection;
        kind: string;
      }) => IntegrationResourceCredentialRef | undefined)
    | undefined;
}): Promise<ResolveResourceSyncCredentialOutput | undefined> {
  const credentialRequirement = resolveResourceCredentialRequirement({
    connection: input.connection,
    kind: input.kind,
    credential: input.credential,
  });
  if (credentialRequirement === undefined) {
    return undefined;
  }

  return resolveIntegrationCredential(
    input.db,
    input.integrationRegistry,
    input.integrationsConfig,
    {
      connectionId: input.connection.id,
      secretType: credentialRequirement.secretType,
      ...(credentialRequirement.purpose === undefined
        ? {}
        : { purpose: credentialRequirement.purpose }),
      ...(credentialRequirement.resolverKey === undefined
        ? {}
        : { resolverKey: credentialRequirement.resolverKey }),
    },
  );
}

function resolveResourceCredentialRequirement(input: {
  connection: IntegrationConnection;
  kind: string;
  credential:
    | IntegrationResourceCredentialRef
    | ((input: {
        connection: IntegrationConnection;
        kind: string;
      }) => IntegrationResourceCredentialRef | undefined)
    | undefined;
}): IntegrationResourceCredentialRef | undefined {
  if (input.credential === undefined) {
    return undefined;
  }

  if (typeof input.credential === "function") {
    return input.credential({
      connection: input.connection,
      kind: input.kind,
    });
  }

  return input.credential;
}

function validateDiscoveredResources(
  resources: ReadonlyArray<DiscoveredIntegrationResource>,
): ReadonlyArray<DiscoveredIntegrationResource> {
  const parsedResources = z.array(DiscoveredIntegrationResourceSchema).parse(resources);
  const seenHandles = new Set<string>();
  const seenExternalIds = new Set<string>();

  for (const resource of parsedResources) {
    if (seenHandles.has(resource.handle)) {
      throw new Error(`Provider returned duplicate resource handle '${resource.handle}'.`);
    }
    seenHandles.add(resource.handle);

    if (resource.externalId !== undefined) {
      if (seenExternalIds.has(resource.externalId)) {
        throw new Error(
          `Provider returned duplicate external resource id '${resource.externalId}'.`,
        );
      }
      seenExternalIds.add(resource.externalId);
    }
  }

  return parsedResources.map((resource) => ({
    ...(resource.externalId === undefined ? {} : { externalId: resource.externalId }),
    handle: resource.handle,
    displayName: resource.displayName,
    metadata: resource.metadata,
  }));
}

async function markResourceSyncing(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
}): Promise<void> {
  await input.db
    .insert(integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: input.familyId,
      kind: input.kind,
      syncState: IntegrationConnectionResourceSyncStates.SYNCING,
      lastSyncStartedAt: sql`now()`,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnectionResourceStates.connectionId,
        integrationConnectionResourceStates.kind,
      ],
      set: {
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.SYNCING,
        lastSyncStartedAt: sql`now()`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: sql`now()`,
      },
    });
}

async function applySuccessfulResourceSync(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
  discoveredResources: ReadonlyArray<DiscoveredIntegrationResource>;
}): Promise<void> {
  await input.db.transaction(async (tx) => {
    const existingResources = await tx.query.integrationConnectionResources.findMany({
      where: (table, { and, eq: whereEq }) =>
        and(whereEq(table.connectionId, input.connectionId), whereEq(table.kind, input.kind)),
    });

    const existingByHandle = new Map<string, (typeof existingResources)[number]>();
    const existingByExternalId = new Map<string, (typeof existingResources)[number]>();

    for (const existingResource of existingResources) {
      existingByHandle.set(existingResource.handle, existingResource);
      if (existingResource.externalId !== null) {
        existingByExternalId.set(existingResource.externalId, existingResource);
      }
    }

    const matchedExistingIds = new Set<string>();
    for (const discoveredResource of input.discoveredResources) {
      const matchedByExternalId =
        discoveredResource.externalId === undefined
          ? undefined
          : existingByExternalId.get(discoveredResource.externalId);
      const matchedByHandle = existingByHandle.get(discoveredResource.handle);
      const matchedResource =
        matchedByExternalId === undefined ? matchedByHandle : matchedByExternalId;

      if (
        matchedByExternalId !== undefined &&
        matchedByHandle !== undefined &&
        matchedByExternalId.id !== matchedByHandle.id
      ) {
        throw new Error(
          `Provider snapshot matched multiple persisted resources for '${discoveredResource.handle}'.`,
        );
      }

      if (matchedResource === undefined) {
        await tx.insert(integrationConnectionResources).values({
          connectionId: input.connectionId,
          familyId: input.familyId,
          kind: input.kind,
          ...(discoveredResource.externalId === undefined
            ? {}
            : { externalId: discoveredResource.externalId }),
          handle: discoveredResource.handle,
          displayName: discoveredResource.displayName,
          status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
          unavailableReason: null,
          metadata: discoveredResource.metadata,
          lastSeenAt: sql`now()`,
          removedAt: null,
          updatedAt: sql`now()`,
        });
        continue;
      }

      if (matchedExistingIds.has(matchedResource.id)) {
        throw new Error(
          `Provider snapshot matched persisted resource '${matchedResource.id}' more than once.`,
        );
      }
      matchedExistingIds.add(matchedResource.id);

      await tx
        .update(integrationConnectionResources)
        .set({
          familyId: input.familyId,
          ...(discoveredResource.externalId === undefined
            ? { externalId: null }
            : { externalId: discoveredResource.externalId }),
          handle: discoveredResource.handle,
          displayName: discoveredResource.displayName,
          status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
          unavailableReason: null,
          metadata: discoveredResource.metadata,
          lastSeenAt: sql`now()`,
          removedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(integrationConnectionResources.id, matchedResource.id));
    }

    const accessibleIdsToMarkUnavailable = existingResources
      .filter(
        (existingResource) =>
          existingResource.status === IntegrationConnectionResourceStatuses.ACCESSIBLE &&
          !matchedExistingIds.has(existingResource.id),
      )
      .map((existingResource) => existingResource.id);

    if (accessibleIdsToMarkUnavailable.length > 0) {
      await tx
        .update(integrationConnectionResources)
        .set({
          status: IntegrationConnectionResourceStatuses.UNAVAILABLE,
          unavailableReason: null,
          removedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(integrationConnectionResources.id, accessibleIdsToMarkUnavailable));
    }

    await tx
      .insert(integrationConnectionResourceStates)
      .values({
        connectionId: input.connectionId,
        familyId: input.familyId,
        kind: input.kind,
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: input.discoveredResources.length,
        lastSyncedAt: sql`now()`,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnectionResourceStates.connectionId,
          integrationConnectionResourceStates.kind,
        ],
        set: {
          familyId: input.familyId,
          syncState: IntegrationConnectionResourceSyncStates.READY,
          totalCount: input.discoveredResources.length,
          lastSyncedAt: sql`now()`,
          lastSyncFinishedAt: sql`now()`,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: sql`now()`,
        },
      });
  });
}

function resolveResourceSyncFailure(error: unknown): { code: string; message: string } {
  if (error instanceof z.ZodError) {
    return {
      code: "resource_sync_invalid_provider_payload",
      message: error.issues.map((issue) => issue.message).join("; "),
    };
  }

  if (error instanceof Error) {
    return {
      code: "resource_sync_failed",
      message: error.message,
    };
  }

  return {
    code: "resource_sync_failed",
    message: "Resource sync failed with a non-error exception.",
  };
}

async function markResourceSyncError(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
  failure: {
    code: string;
    message: string;
  };
}): Promise<void> {
  await input.db
    .insert(integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: input.familyId,
      kind: input.kind,
      syncState: IntegrationConnectionResourceSyncStates.ERROR,
      lastSyncFinishedAt: sql`now()`,
      lastErrorCode: input.failure.code,
      lastErrorMessage: input.failure.message,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnectionResourceStates.connectionId,
        integrationConnectionResourceStates.kind,
      ],
      set: {
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.ERROR,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: input.failure.code,
        lastErrorMessage: input.failure.message,
        updatedAt: sql`now()`,
      },
    });
}

export const SyncIntegrationConnectionResourcesWorkflow = defineWorkflow<
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput
>(
  {
    name: "control-plane.integration-connections.sync-resources",
    version: "1",
  },
  async ({ input, step }) => {
    const ctx = await getWorkflowContext();

    return step.run(
      {
        name: "sync-integration-connection-resources",
      },
      async () =>
        syncIntegrationConnectionResources({
          db: ctx.db,
          integrationRegistry: ctx.integrationRegistry,
          integrationsConfig: ctx.integrationsConfig,
          workflowInput: input,
        }),
    );
  },
);
