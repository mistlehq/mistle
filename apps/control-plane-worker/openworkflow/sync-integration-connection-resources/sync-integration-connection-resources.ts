import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { IntegrationConnectionStatuses, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type {
  AnyIntegrationDefinition,
  IntegrationResolvedTarget,
  IntegrationRegistry,
  ListConnectionResourcesInput,
  ListConnectionResourcesResult,
} from "@mistle/integrations-core";
import type {
  SyncIntegrationConnectionResourcesWorkflowInput,
  SyncIntegrationConnectionResourcesWorkflowOutput,
} from "@mistle/workflow-registry/control-plane";
import { z } from "zod";

import { applySuccessfulResourceSync } from "./apply-successful-resource-sync.js";
import { markResourceSyncError } from "./mark-resource-sync-error.js";
import { markResourceSyncing } from "./mark-resource-syncing.js";
import { resolveResourceCredential } from "./resolve-resource-credential.js";
import { resolveResourceSyncFailure } from "./resolve-resource-sync-failure.js";
import { resolveTargetSecrets } from "./resolve-target-secrets.js";
import { validateDiscoveredResources } from "./validate-discovered-resources.js";

const UnknownRecordSchema = z.record(z.string(), z.unknown());
const StringRecordSchema = z.record(z.string(), z.string());

export async function syncIntegrationConnectionResources(
  deps: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    controlPlaneInternalClient?: ControlPlaneInternalClient;
  },
  input: SyncIntegrationConnectionResourcesWorkflowInput,
): Promise<SyncIntegrationConnectionResourcesWorkflowOutput> {
  const connection = await deps.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      organizationId: true,
      targetKey: true,
      status: true,
      externalSubjectId: true,
      config: true,
    },
    where: (table, { eq }) => eq(table.id, input.connectionId),
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
    throw new Error(`Integration connection '${input.connectionId}' was not found.`);
  }

  const target = connection.target;
  if (target === null) {
    throw new Error("Expected integration connection target relation to be present.");
  }

  if (connection.organizationId !== input.organizationId) {
    throw new Error(
      `Integration connection '${input.connectionId}' does not belong to organization '${input.organizationId}'.`,
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
      db: deps.db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.kind,
    });

    const definition = deps.integrationRegistry.getDefinition({
      familyId: target.familyId,
      variantId: target.variantId,
    });
    if (definition === undefined) {
      throw new Error(
        `Integration definition '${target.familyId}::${target.variantId}' was not found.`,
      );
    }

    const resourceDefinition = findResourceDefinition(definition, input.kind);
    if (resourceDefinition === undefined) {
      throw new Error(
        `Resource kind '${input.kind}' is not declared for '${target.familyId}::${target.variantId}'.`,
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
    const resolvedTargetSecrets = await resolveTargetSecrets({
      targetKey: target.targetKey,
      encryptedSecrets: target.secrets,
      controlPlaneInternalClient: deps.controlPlaneInternalClient,
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
      connection: {
        id: connection.id,
        status: connection.status,
        ...(connection.externalSubjectId === null
          ? {}
          : { externalSubjectId: connection.externalSubjectId }),
        config: parsedConnectionConfig,
      },
      kind: input.kind,
      credential: resourceDefinition.credential,
      controlPlaneInternalClient: deps.controlPlaneInternalClient,
    });

    const listedResources = await definition.listConnectionResources({
      organizationId: input.organizationId,
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
      kind: input.kind,
      ...(resolvedCredential === undefined ? {} : { credential: resolvedCredential }),
    });

    const discoveredResources = validateDiscoveredResources(listedResources.resources);

    await applySuccessfulResourceSync({
      db: deps.db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.kind,
      discoveredResources,
    });
  } catch (error) {
    await markResourceSyncError({
      db: deps.db,
      connectionId: connection.id,
      familyId: target.familyId,
      kind: input.kind,
      failure: resolveResourceSyncFailure(error),
    });
    throw error;
  }

  return {
    organizationId: input.organizationId,
    connectionId: input.connectionId,
    kind: input.kind,
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
