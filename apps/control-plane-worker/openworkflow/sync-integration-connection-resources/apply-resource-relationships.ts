import {
  IntegrationConnectionResourceStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type {
  DiscoveredIntegrationResource,
  DiscoveredIntegrationResourceRelationship,
  IntegrationResourceRelationshipDefinition,
} from "@mistle/integrations-core";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

type ControlPlaneTransaction = Parameters<Parameters<ControlPlaneDatabase["transaction"]>[0]>[0];

type PersistedResource = {
  id: string;
  kind: string;
  externalId: string | null;
  handle: string;
  status: string;
  removedAt: string | null;
};

type ResourceIdentity = {
  externalId: string | undefined;
  handle: string;
};

type CompleteRelationshipScope = {
  relationshipKind: string;
  subjectResourceKind: string;
  objectResourceKind: string;
  scopeKind: string;
  scopeHandle: string;
  scopeResourceId: string;
};

export async function applyResourceRelationships(input: {
  tx: ControlPlaneTransaction;
  connectionId: string;
  familyId: string;
  syncedResourceKind: string;
  discoveredResources: ReadonlyArray<DiscoveredIntegrationResource>;
  discoveredRelationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship>;
  relationshipDefinitions: ReadonlyArray<IntegrationResourceRelationshipDefinition>;
}): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(input.tx);
  const resourceKinds = relationshipResourceKinds({
    syncedResourceKind: input.syncedResourceKind,
    relationships: input.discoveredRelationships,
  });
  const resourceIndex = buildResourceIndex(
    await input.tx.query.integrationConnectionResources.findMany({
      columns: {
        id: true,
        kind: true,
        externalId: true,
        handle: true,
        status: true,
        removedAt: true,
      },
      where: (table, { and: whereAnd, eq: whereEq, inArray: whereInArray }) =>
        whereAnd(
          whereEq(table.connectionId, input.connectionId),
          whereInArray(table.kind, resourceKinds),
        ),
    }),
  );
  const completeScopes = completeRelationshipScopes({
    syncedResourceKind: input.syncedResourceKind,
    discoveredResources: input.discoveredResources,
    relationshipDefinitions: input.relationshipDefinitions,
    resourceIndex,
  });
  if (input.discoveredRelationships.length === 0 && completeScopes.length === 0) {
    return;
  }

  const seenRelationshipKeysByScope = new Map<string, Set<string>>(
    completeScopes.map((scope) => [resourceRelationshipScopeKey(scope), new Set<string>()]),
  );

  for (const relationship of input.discoveredRelationships) {
    const scopeResource = resolveScopeResource({
      relationship,
      resourceIndex,
    });
    const subjectResourceId = resolveOptionalResourceId({
      resourceKind: relationship.subjectResourceKind,
      identity: {
        externalId: relationship.subjectExternalId,
        handle: relationship.subjectHandle,
      },
      resourceIndex,
    });
    const objectResourceId = resolveOptionalResourceId({
      resourceKind: relationship.objectResourceKind,
      identity: {
        externalId: relationship.objectExternalId,
        handle: relationship.objectHandle,
      },
      resourceIndex,
    });
    const relationshipKey = resourceRelationshipStorageKey(relationship);
    const scopeKey = resourceRelationshipScopeKey(relationship);
    const seenRelationshipKeys = seenRelationshipKeysByScope.get(scopeKey) ?? new Set<string>();
    if (seenRelationshipKeys.has(relationshipKey)) {
      throw new Error(
        `Provider returned duplicate relationship '${relationship.relationshipKind}' from '${relationship.subjectHandle}' to '${relationship.objectHandle}' in scope '${relationship.scopeHandle}'.`,
      );
    }
    seenRelationshipKeys.add(relationshipKey);
    seenRelationshipKeysByScope.set(scopeKey, seenRelationshipKeys);

    await input.tx
      .insert(tables.integrationConnectionResourceRelationships)
      .values({
        connectionId: input.connectionId,
        familyId: input.familyId,
        relationshipKind: relationship.relationshipKind,
        subjectResourceId,
        subjectResourceKind: relationship.subjectResourceKind,
        ...(relationship.subjectExternalId === undefined
          ? {}
          : { subjectExternalId: relationship.subjectExternalId }),
        subjectHandle: relationship.subjectHandle,
        objectResourceId,
        objectResourceKind: relationship.objectResourceKind,
        ...(relationship.objectExternalId === undefined
          ? {}
          : { objectExternalId: relationship.objectExternalId }),
        objectHandle: relationship.objectHandle,
        scopeResourceId: scopeResource.id,
        scopeKind: relationship.scopeKind,
        ...(relationship.scopeExternalId === undefined
          ? {}
          : { scopeExternalId: relationship.scopeExternalId }),
        scopeHandle: relationship.scopeHandle,
        metadata: relationship.metadata,
        lastSeenAt: sql`now()`,
        removedAt: null,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [
          tables.integrationConnectionResourceRelationships.connectionId,
          tables.integrationConnectionResourceRelationships.relationshipKind,
          tables.integrationConnectionResourceRelationships.subjectResourceKind,
          tables.integrationConnectionResourceRelationships.subjectHandle,
          tables.integrationConnectionResourceRelationships.objectResourceKind,
          tables.integrationConnectionResourceRelationships.objectHandle,
          tables.integrationConnectionResourceRelationships.scopeKind,
          tables.integrationConnectionResourceRelationships.scopeHandle,
        ],
        set: {
          familyId: input.familyId,
          subjectResourceId,
          subjectExternalId: relationship.subjectExternalId ?? null,
          objectResourceId,
          objectExternalId: relationship.objectExternalId ?? null,
          scopeResourceId: scopeResource.id,
          scopeExternalId: relationship.scopeExternalId ?? null,
          metadata: relationship.metadata,
          lastSeenAt: sql`now()`,
          removedAt: null,
          updatedAt: sql`now()`,
        },
      });
  }

  for (const scope of completeScopes) {
    const seenRelationshipKeys =
      seenRelationshipKeysByScope.get(resourceRelationshipScopeKey(scope)) ?? new Set<string>();
    const existingRelationships = await input.tx
      .select({
        id: tables.integrationConnectionResourceRelationships.id,
        subjectResourceKind: tables.integrationConnectionResourceRelationships.subjectResourceKind,
        subjectHandle: tables.integrationConnectionResourceRelationships.subjectHandle,
        objectResourceKind: tables.integrationConnectionResourceRelationships.objectResourceKind,
        objectHandle: tables.integrationConnectionResourceRelationships.objectHandle,
        scopeHandle: tables.integrationConnectionResourceRelationships.scopeHandle,
      })
      .from(tables.integrationConnectionResourceRelationships)
      .where(
        and(
          eq(tables.integrationConnectionResourceRelationships.connectionId, input.connectionId),
          eq(
            tables.integrationConnectionResourceRelationships.relationshipKind,
            scope.relationshipKind,
          ),
          eq(
            tables.integrationConnectionResourceRelationships.subjectResourceKind,
            scope.subjectResourceKind,
          ),
          eq(
            tables.integrationConnectionResourceRelationships.objectResourceKind,
            scope.objectResourceKind,
          ),
          eq(tables.integrationConnectionResourceRelationships.scopeKind, scope.scopeKind),
          or(
            eq(tables.integrationConnectionResourceRelationships.scopeHandle, scope.scopeHandle),
            eq(
              tables.integrationConnectionResourceRelationships.scopeResourceId,
              scope.scopeResourceId,
            ),
          ),
          isNull(tables.integrationConnectionResourceRelationships.removedAt),
        ),
      );

    const relationshipIdsToRemove = existingRelationships
      .filter(
        (relationship) =>
          !seenRelationshipKeys.has(
            resourceRelationshipStorageKey({
              relationshipKind: scope.relationshipKind,
              subjectResourceKind: relationship.subjectResourceKind,
              subjectHandle: relationship.subjectHandle,
              objectResourceKind: relationship.objectResourceKind,
              objectHandle: relationship.objectHandle,
              scopeKind: scope.scopeKind,
              scopeHandle: relationship.scopeHandle,
            }),
          ),
      )
      .map((relationship) => relationship.id);

    if (relationshipIdsToRemove.length > 0) {
      await input.tx
        .update(tables.integrationConnectionResourceRelationships)
        .set({
          removedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          inArray(tables.integrationConnectionResourceRelationships.id, relationshipIdsToRemove),
        );
    }
  }
}

function relationshipResourceKinds(input: {
  syncedResourceKind: string;
  relationships: ReadonlyArray<DiscoveredIntegrationResourceRelationship>;
}): string[] {
  const resourceKinds = new Set<string>([input.syncedResourceKind]);

  for (const relationship of input.relationships) {
    resourceKinds.add(relationship.scopeKind);
    resourceKinds.add(relationship.subjectResourceKind);
    resourceKinds.add(relationship.objectResourceKind);
  }

  return [...resourceKinds];
}

function completeRelationshipScopes(input: {
  syncedResourceKind: string;
  discoveredResources: ReadonlyArray<DiscoveredIntegrationResource>;
  relationshipDefinitions: ReadonlyArray<IntegrationResourceRelationshipDefinition>;
  resourceIndex: {
    byKindAndExternalId: ReadonlyMap<string, PersistedResource>;
    byKindAndHandle: ReadonlyMap<string, PersistedResource>;
  };
}): CompleteRelationshipScope[] {
  const scopes: CompleteRelationshipScope[] = [];
  const scopedRelationshipDefinitions = input.relationshipDefinitions.filter((definition) =>
    definition.scopeDefinitions.some(
      (scopeDefinition) => scopeDefinition.scopeKind === input.syncedResourceKind,
    ),
  );

  for (const resource of input.discoveredResources) {
    const scopeResource = resolveResource({
      resourceKind: input.syncedResourceKind,
      identity: {
        externalId: resource.externalId,
        handle: resource.handle,
      },
      resourceIndex: input.resourceIndex,
    });
    if (scopeResource === undefined) {
      continue;
    }

    for (const definition of scopedRelationshipDefinitions) {
      scopes.push({
        relationshipKind: definition.relationshipKind,
        subjectResourceKind: definition.subjectResourceKind,
        objectResourceKind: definition.objectResourceKind,
        scopeKind: input.syncedResourceKind,
        scopeHandle: resource.handle,
        scopeResourceId: scopeResource.id,
      });
    }
  }

  return scopes;
}

function buildResourceIndex(resources: ReadonlyArray<PersistedResource>): {
  byKindAndExternalId: ReadonlyMap<string, PersistedResource>;
  byKindAndHandle: ReadonlyMap<string, PersistedResource>;
} {
  const byKindAndExternalId = new Map<string, PersistedResource>();
  const byKindAndHandle = new Map<string, PersistedResource>();

  for (const resource of resources) {
    byKindAndHandle.set(
      resourceIdentityKey({ kind: resource.kind, handle: resource.handle }),
      resource,
    );
    if (resource.externalId !== null) {
      byKindAndExternalId.set(
        resourceIdentityKey({ kind: resource.kind, externalId: resource.externalId }),
        resource,
      );
    }
  }

  return { byKindAndExternalId, byKindAndHandle };
}

function resolveScopeResource(input: {
  relationship: DiscoveredIntegrationResourceRelationship;
  resourceIndex: {
    byKindAndExternalId: ReadonlyMap<string, PersistedResource>;
    byKindAndHandle: ReadonlyMap<string, PersistedResource>;
  };
}): PersistedResource {
  const resource = resolveResource({
    resourceKind: input.relationship.scopeKind,
    identity: {
      externalId: input.relationship.scopeExternalId,
      handle: input.relationship.scopeHandle,
    },
    resourceIndex: input.resourceIndex,
  });

  if (
    resource === undefined ||
    resource.status !== IntegrationConnectionResourceStatuses.ACCESSIBLE ||
    resource.removedAt !== null
  ) {
    throw new Error(
      `Relationship scope '${input.relationship.scopeKind}:${input.relationship.scopeHandle}' does not resolve to an accessible resource.`,
    );
  }

  return resource;
}

function resolveOptionalResourceId(input: {
  resourceKind: string;
  identity: ResourceIdentity;
  resourceIndex: {
    byKindAndExternalId: ReadonlyMap<string, PersistedResource>;
    byKindAndHandle: ReadonlyMap<string, PersistedResource>;
  };
}): string | null {
  return resolveResource(input)?.id ?? null;
}

function resolveResource(input: {
  resourceKind: string;
  identity: ResourceIdentity;
  resourceIndex: {
    byKindAndExternalId: ReadonlyMap<string, PersistedResource>;
    byKindAndHandle: ReadonlyMap<string, PersistedResource>;
  };
}): PersistedResource | undefined {
  const resource =
    input.identity.externalId === undefined
      ? input.resourceIndex.byKindAndHandle.get(
          resourceIdentityKey({
            kind: input.resourceKind,
            handle: input.identity.handle,
          }),
        )
      : input.resourceIndex.byKindAndExternalId.get(
          resourceIdentityKey({
            kind: input.resourceKind,
            externalId: input.identity.externalId,
          }),
        );

  if (resource !== undefined && resource.handle !== input.identity.handle) {
    throw new Error(
      `Relationship referenced resource '${input.resourceKind}:${input.identity.handle}' with mismatched external id '${input.identity.externalId}'.`,
    );
  }

  if (resource !== undefined || input.identity.externalId === undefined) {
    return resource;
  }

  const handleMatchedResource = input.resourceIndex.byKindAndHandle.get(
    resourceIdentityKey({
      kind: input.resourceKind,
      handle: input.identity.handle,
    }),
  );
  if (
    handleMatchedResource !== undefined &&
    handleMatchedResource.externalId !== null &&
    handleMatchedResource.externalId !== input.identity.externalId
  ) {
    throw new Error(
      `Relationship referenced resource '${input.resourceKind}:${input.identity.handle}' with external id '${input.identity.externalId}' but persisted resource has external id '${handleMatchedResource.externalId}'.`,
    );
  }

  return handleMatchedResource;
}

function resourceIdentityKey(
  input:
    | {
        kind: string;
        externalId: string;
      }
    | {
        kind: string;
        handle: string;
      },
): string {
  return "externalId" in input
    ? JSON.stringify([input.kind, "external_id", input.externalId])
    : JSON.stringify([input.kind, "handle", input.handle]);
}

function resourceRelationshipScopeKey(input: {
  relationshipKind: string;
  subjectResourceKind: string;
  objectResourceKind: string;
  scopeKind: string;
  scopeHandle: string;
}): string {
  return JSON.stringify([
    input.relationshipKind,
    input.subjectResourceKind,
    input.objectResourceKind,
    input.scopeKind,
    input.scopeHandle,
  ]);
}

function resourceRelationshipStorageKey(input: {
  relationshipKind: string;
  subjectResourceKind: string;
  subjectHandle: string;
  objectResourceKind: string;
  objectHandle: string;
  scopeKind: string;
  scopeHandle: string;
}): string {
  return JSON.stringify([
    input.relationshipKind,
    input.subjectResourceKind,
    input.subjectHandle,
    input.objectResourceKind,
    input.objectHandle,
    input.scopeKind,
    input.scopeHandle,
  ]);
}
