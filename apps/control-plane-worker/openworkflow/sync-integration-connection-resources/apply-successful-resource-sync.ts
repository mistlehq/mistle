import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type {
  DiscoveredIntegrationResource,
  DiscoveredIntegrationResourceAttribute,
  IntegrationResourceAttributeDefinition,
} from "@mistle/integrations-core";
import { and, eq, inArray, sql } from "drizzle-orm";

type ControlPlaneTransaction = Parameters<Parameters<ControlPlaneDatabase["transaction"]>[0]>[0];
type ResourceIdentityCandidate = {
  externalId?: string;
  handle: string;
};
type ExistingResourceForAttributeMatch = {
  id: string;
  handle: string;
  status: string;
  removedAt: string | null;
};

export async function applySuccessfulResourceSync(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  familyId: string;
  kind: string;
  syncStartedAt: string;
  discoveredResources: ReadonlyArray<DiscoveredIntegrationResource>;
  discoveredAttributes?: ReadonlyArray<DiscoveredIntegrationResourceAttribute>;
  attributeDefinitions?: ReadonlyArray<IntegrationResourceAttributeDefinition>;
}): Promise<boolean> {
  return input.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const [lockedState] = await tx
      .select({
        lastSyncStartedAt: tables.integrationConnectionResourceStates.lastSyncStartedAt,
        syncState: tables.integrationConnectionResourceStates.syncState,
      })
      .from(tables.integrationConnectionResourceStates)
      .where(
        and(
          eq(tables.integrationConnectionResourceStates.connectionId, input.connectionId),
          eq(tables.integrationConnectionResourceStates.kind, input.kind),
        ),
      )
      .for("update");
    if (
      lockedState === undefined ||
      lockedState.syncState !== IntegrationConnectionResourceSyncStates.SYNCING ||
      lockedState.lastSyncStartedAt !== input.syncStartedAt
    ) {
      return false;
    }

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
        await tx.insert(tables.integrationConnectionResources).values({
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
        .update(tables.integrationConnectionResources)
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
        .where(eq(tables.integrationConnectionResources.id, matchedResource.id));
    }

    await applyResourceAttributes({
      tx,
      connectionId: input.connectionId,
      familyId: input.familyId,
      kind: input.kind,
      discoveredResources: input.discoveredResources,
      accessibleResources: existingResources
        .filter(
          (resource) =>
            resource.status === IntegrationConnectionResourceStatuses.ACCESSIBLE &&
            resource.removedAt === null,
        )
        .map((resource) => ({
          ...(resource.externalId === null ? {} : { externalId: resource.externalId }),
          handle: resource.handle,
        })),
      discoveredAttributes: input.discoveredAttributes ?? [],
      attributeDefinitions: input.attributeDefinitions ?? [],
    });

    for (const resourceId of attributeBearingAccessibleExistingResourceIds({
      attributes: input.discoveredAttributes ?? [],
      existingByExternalId,
      existingByHandle,
    })) {
      matchedExistingIds.add(resourceId);
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
        .update(tables.integrationConnectionResources)
        .set({
          status: IntegrationConnectionResourceStatuses.UNAVAILABLE,
          unavailableReason: null,
          removedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(tables.integrationConnectionResources.id, accessibleIdsToMarkUnavailable));
    }

    await tx
      .update(tables.integrationConnectionResourceStates)
      .set({
        familyId: input.familyId,
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: input.discoveredResources.length,
        lastSyncedAt: sql`now()`,
        lastSyncFinishedAt: sql`now()`,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: sql`now()`,
      })
      .where(
        sql`${tables.integrationConnectionResourceStates.connectionId} = ${input.connectionId} and ${tables.integrationConnectionResourceStates.kind} = ${input.kind}`,
      );

    return true;
  });
}

function attributeBearingAccessibleExistingResourceIds(input: {
  attributes: ReadonlyArray<DiscoveredIntegrationResourceAttribute>;
  existingByExternalId: ReadonlyMap<string, ExistingResourceForAttributeMatch>;
  existingByHandle: ReadonlyMap<string, ExistingResourceForAttributeMatch>;
}): ReadonlySet<string> {
  const resourceIds = new Set<string>();

  for (const attribute of input.attributes) {
    const existingResource =
      attribute.resourceExternalId === undefined
        ? input.existingByHandle.get(attribute.resourceHandle)
        : input.existingByExternalId.get(attribute.resourceExternalId);

    if (
      existingResource !== undefined &&
      existingResource.handle === attribute.resourceHandle &&
      existingResource.status === IntegrationConnectionResourceStatuses.ACCESSIBLE &&
      existingResource.removedAt === null
    ) {
      resourceIds.add(existingResource.id);
    }
  }

  return resourceIds;
}

async function applyResourceAttributes(input: {
  tx: ControlPlaneTransaction;
  connectionId: string;
  familyId: string;
  kind: string;
  discoveredResources: ReadonlyArray<DiscoveredIntegrationResource>;
  accessibleResources: ReadonlyArray<ResourceIdentityCandidate>;
  discoveredAttributes: ReadonlyArray<DiscoveredIntegrationResourceAttribute>;
  attributeDefinitions: ReadonlyArray<IntegrationResourceAttributeDefinition>;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.tx);
  const definitionsByKey = buildAttributeDefinitionsByKey(input.attributeDefinitions);
  const declaredAttributeKeys = [...definitionsByKey.keys()];
  const resourcesByIdentity = buildResourceIdentityIndex([
    ...input.accessibleResources,
    ...input.discoveredResources,
  ]);
  const seenAttributeKeys = new Set<string>();

  for (const attribute of input.discoveredAttributes) {
    if (attribute.resourceKind !== input.kind) {
      throw new Error(
        `Provider returned attribute '${attribute.key}' for resource kind '${attribute.resourceKind}' while applying '${input.kind}'.`,
      );
    }
    const definition = definitionsByKey.get(attribute.key);
    if (definition === undefined) {
      throw new Error(
        `Provider returned undeclared attribute '${attribute.key}' for resource kind '${input.kind}'.`,
      );
    }
    if (definition.valueType !== attribute.valueType) {
      throw new Error(
        `Provider returned attribute '${attribute.key}' with value type '${attribute.valueType}' but declared '${definition.valueType}'.`,
      );
    }
    validateCanonicalAttributeValue(attribute);
    validateAttributeResource({
      attribute,
      resourcesByIdentity,
    });

    const seenKey = resourceAttributeSeenKey(attribute);
    if (seenAttributeKeys.has(seenKey)) {
      throw new Error(
        `Provider returned duplicate attribute '${attribute.key}' for resource '${attribute.resourceHandle}'.`,
      );
    }
    seenAttributeKeys.add(seenKey);

    await input.tx
      .insert(tables.integrationConnectionResourceAttributes)
      .values({
        connectionId: input.connectionId,
        familyId: input.familyId,
        resourceKind: input.kind,
        ...(attribute.resourceExternalId === undefined
          ? {}
          : { resourceExternalId: attribute.resourceExternalId }),
        resourceHandle: attribute.resourceHandle,
        attributeKey: attribute.key,
        attributeValue: attribute.value,
        valueType: attribute.valueType,
        metadata: attribute.metadata,
        lastSeenAt: sql`now()`,
        removedAt: null,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          tables.integrationConnectionResourceAttributes.connectionId,
          tables.integrationConnectionResourceAttributes.resourceKind,
          tables.integrationConnectionResourceAttributes.resourceHandle,
          tables.integrationConnectionResourceAttributes.attributeKey,
        ],
        set: {
          familyId: input.familyId,
          resourceExternalId: attribute.resourceExternalId ?? null,
          attributeValue: attribute.value,
          valueType: attribute.valueType,
          metadata: attribute.metadata,
          lastSeenAt: sql`now()`,
          removedAt: null,
          updatedAt: sql`now()`,
        },
      });
  }

  for (const definition of definitionsByKey.values()) {
    if (definition.actorPolicyEligible !== true) {
      continue;
    }

    for (const resource of input.discoveredResources) {
      if (
        !seenAttributeKeys.has(
          resourceAttributeStorageKey({
            resourceHandle: resource.handle,
            attributeKey: definition.key,
          }),
        )
      ) {
        throw new Error(
          `Provider omitted actor-policy attribute '${definition.key}' for resource '${resource.handle}'.`,
        );
      }
    }
  }

  if (declaredAttributeKeys.length === 0) {
    return;
  }

  const existingAttributes = await input.tx
    .select({
      id: tables.integrationConnectionResourceAttributes.id,
      resourceHandle: tables.integrationConnectionResourceAttributes.resourceHandle,
      attributeKey: tables.integrationConnectionResourceAttributes.attributeKey,
    })
    .from(tables.integrationConnectionResourceAttributes)
    .where(
      and(
        eq(tables.integrationConnectionResourceAttributes.connectionId, input.connectionId),
        eq(tables.integrationConnectionResourceAttributes.familyId, input.familyId),
        eq(tables.integrationConnectionResourceAttributes.resourceKind, input.kind),
        inArray(tables.integrationConnectionResourceAttributes.attributeKey, declaredAttributeKeys),
      ),
    );

  const attributeIdsToRemove = existingAttributes
    .filter(
      (attribute) =>
        !seenAttributeKeys.has(
          resourceAttributeStorageKey({
            resourceHandle: attribute.resourceHandle,
            attributeKey: attribute.attributeKey,
          }),
        ),
    )
    .map((attribute) => attribute.id);

  if (attributeIdsToRemove.length === 0) {
    return;
  }

  await input.tx
    .update(tables.integrationConnectionResourceAttributes)
    .set({
      removedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(inArray(tables.integrationConnectionResourceAttributes.id, attributeIdsToRemove));
}

function buildAttributeDefinitionsByKey(
  definitions: ReadonlyArray<IntegrationResourceAttributeDefinition>,
): ReadonlyMap<string, IntegrationResourceAttributeDefinition> {
  const definitionsByKey = new Map<string, IntegrationResourceAttributeDefinition>();

  for (const definition of definitions) {
    if (definitionsByKey.has(definition.key)) {
      throw new Error(`Provider declared duplicate resource attribute key '${definition.key}'.`);
    }
    definitionsByKey.set(definition.key, definition);
  }

  return definitionsByKey;
}

function buildResourceIdentityIndex(resources: ReadonlyArray<ResourceIdentityCandidate>): {
  byExternalId: ReadonlyMap<string, ResourceIdentityCandidate>;
  byHandle: ReadonlyMap<string, ResourceIdentityCandidate>;
} {
  const byExternalId = new Map<string, ResourceIdentityCandidate>();
  const byHandle = new Map<string, ResourceIdentityCandidate>();

  for (const resource of resources) {
    byHandle.set(resource.handle, resource);
    if (resource.externalId !== undefined) {
      byExternalId.set(resource.externalId, resource);
    }
  }

  return { byExternalId, byHandle };
}

function validateAttributeResource(input: {
  attribute: DiscoveredIntegrationResourceAttribute;
  resourcesByIdentity: {
    byExternalId: ReadonlyMap<string, ResourceIdentityCandidate>;
    byHandle: ReadonlyMap<string, ResourceIdentityCandidate>;
  };
}): void {
  const matchedResource =
    input.attribute.resourceExternalId === undefined
      ? input.resourcesByIdentity.byHandle.get(input.attribute.resourceHandle)
      : input.resourcesByIdentity.byExternalId.get(input.attribute.resourceExternalId);

  if (matchedResource === undefined) {
    throw new Error(
      `Provider returned attribute '${input.attribute.key}' for unknown resource '${input.attribute.resourceHandle}'.`,
    );
  }
  if (matchedResource.handle !== input.attribute.resourceHandle) {
    throw new Error(
      `Provider returned attribute '${input.attribute.key}' for external resource '${input.attribute.resourceExternalId}' with mismatched handle '${input.attribute.resourceHandle}'.`,
    );
  }
}

function validateCanonicalAttributeValue(attribute: {
  key: string;
  value: string;
  valueType: DiscoveredIntegrationResourceAttribute["valueType"];
}): void {
  if (attribute.valueType === "boolean") {
    if (attribute.value !== "true" && attribute.value !== "false") {
      throw new Error(
        `Provider returned boolean attribute '${attribute.key}' with non-canonical value '${attribute.value}'.`,
      );
    }
    return;
  }

  if (attribute.valueType === "number") {
    const numericValue = Number(attribute.value);
    if (!Number.isFinite(numericValue) || String(numericValue) !== attribute.value) {
      throw new Error(
        `Provider returned number attribute '${attribute.key}' with non-canonical value '${attribute.value}'.`,
      );
    }
  }
}

function resourceAttributeSeenKey(attribute: DiscoveredIntegrationResourceAttribute): string {
  return resourceAttributeStorageKey({
    resourceHandle: attribute.resourceHandle,
    attributeKey: attribute.key,
  });
}

function resourceAttributeStorageKey(input: {
  resourceHandle: string;
  attributeKey: string;
}): string {
  return JSON.stringify([input.resourceHandle, input.attributeKey]);
}
