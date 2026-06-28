import {
  type ControlPlaneDatabase,
  type IntegrationConnectionResourceAttributeValueType,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, isNull, or, type SQL } from "drizzle-orm";

export const ActorPolicyQueryResultStates = {
  DATA_UNAVAILABLE: "data_unavailable",
  MATCHED: "matched",
  NOT_MATCHED: "not_matched",
} as const;

export type ActorPolicyQueryResultState =
  (typeof ActorPolicyQueryResultStates)[keyof typeof ActorPolicyQueryResultStates];

export type ActorPolicyQueryResult = {
  state: ActorPolicyQueryResultState;
  reason?: string;
};

export type ActorPolicyResourceReference =
  | {
      resourceKind: string;
      resourceId: string;
    }
  | {
      resourceKind: string;
      externalId: string;
    }
  | {
      resourceKind: string;
      handle: string;
    };

export type ActorPolicyRelationshipScopeReference = ActorPolicyResourceReference;

type ResolvedActorPolicyResource = {
  id: string;
  kind: string;
  externalId: string | null;
  handle: string;
};

export async function queryActorPolicyResourceAttribute(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  actor: ActorPolicyResourceReference;
  attributeKey: string;
  attributeValue: string;
  valueType: IntegrationConnectionResourceAttributeValueType;
}): Promise<ActorPolicyQueryResult> {
  const actorResource = await resolveAccessibleResource({
    db: input.db,
    connectionId: input.connectionId,
    reference: input.actor,
  });
  if (actorResource === undefined) {
    return dataUnavailable("actor_resource_unavailable");
  }

  const isResourceKindReady = await isResourceKindReadyForAttributes({
    db: input.db,
    connectionId: input.connectionId,
    resourceKind: actorResource.kind,
  });
  if (!isResourceKindReady) {
    return dataUnavailable("actor_resource_kind_not_ready");
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      attributeValue: tables.integrationConnectionResourceAttributes.attributeValue,
      valueType: tables.integrationConnectionResourceAttributes.valueType,
    })
    .from(tables.integrationConnectionResourceAttributes)
    .where(
      and(
        eq(tables.integrationConnectionResourceAttributes.connectionId, input.connectionId),
        eq(tables.integrationConnectionResourceAttributes.resourceKind, actorResource.kind),
        eq(tables.integrationConnectionResourceAttributes.resourceHandle, actorResource.handle),
        eq(tables.integrationConnectionResourceAttributes.attributeKey, input.attributeKey),
        isNull(tables.integrationConnectionResourceAttributes.removedAt),
      ),
    )
    .limit(1);
  const attribute = rows[0];
  if (attribute === undefined) {
    return dataUnavailable("actor_attribute_unavailable");
  }

  if (attribute.valueType !== input.valueType) {
    return dataUnavailable("actor_attribute_type_unavailable");
  }

  if (attribute.attributeValue !== input.attributeValue) {
    return notMatched();
  }

  return matched();
}

export async function queryActorPolicyResourceRelationship(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  relationshipKind: string;
  actor: ActorPolicyResourceReference;
  actorSet: ActorPolicyResourceReference;
  scope: ActorPolicyRelationshipScopeReference;
}): Promise<ActorPolicyQueryResult> {
  const actorResource = await resolveAccessibleResource({
    db: input.db,
    connectionId: input.connectionId,
    reference: input.actor,
  });
  if (
    actorResource === undefined &&
    (await resourceRowExists({
      db: input.db,
      connectionId: input.connectionId,
      reference: input.actor,
    }))
  ) {
    return dataUnavailable("actor_resource_unavailable");
  }
  const subjectPredicate = createSubjectRelationshipPredicate({
    db: input.db,
    reference: input.actor,
    resource: actorResource,
  });
  if (subjectPredicate === undefined) {
    return dataUnavailable("actor_resource_unavailable");
  }

  const actorSetResource = await resolveAccessibleResource({
    db: input.db,
    connectionId: input.connectionId,
    reference: input.actorSet,
  });
  if (
    actorSetResource === undefined &&
    (await resourceRowExists({
      db: input.db,
      connectionId: input.connectionId,
      reference: input.actorSet,
    }))
  ) {
    return dataUnavailable("actor_set_resource_unavailable");
  }
  const objectPredicate = createObjectRelationshipPredicate({
    db: input.db,
    reference: input.actorSet,
    resource: actorSetResource,
  });
  if (objectPredicate === undefined) {
    return dataUnavailable("actor_set_resource_unavailable");
  }

  const scopeResource = await resolveAccessibleResource({
    db: input.db,
    connectionId: input.connectionId,
    reference: input.scope,
  });
  if (scopeResource === undefined) {
    return dataUnavailable("relationship_scope_resource_unavailable");
  }

  const isReady = await isActorSetResourceKindReadyForRelationships({
    db: input.db,
    connectionId: input.connectionId,
    resourceKind: input.actorSet.resourceKind,
  });
  if (!isReady) {
    return dataUnavailable("actor_set_resource_kind_not_ready");
  }

  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResourceRelationships.id,
    })
    .from(tables.integrationConnectionResourceRelationships)
    .where(
      and(
        eq(tables.integrationConnectionResourceRelationships.connectionId, input.connectionId),
        eq(
          tables.integrationConnectionResourceRelationships.relationshipKind,
          input.relationshipKind,
        ),
        subjectPredicate,
        objectPredicate,
        eq(tables.integrationConnectionResourceRelationships.scopeResourceId, scopeResource.id),
        isNull(tables.integrationConnectionResourceRelationships.removedAt),
      ),
    )
    .limit(1);

  if (rows[0] === undefined) {
    return notMatched();
  }

  return matched();
}

async function resolveAccessibleResource(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  reference: ActorPolicyResourceReference;
}): Promise<ResolvedActorPolicyResource | undefined> {
  if ("resourceId" in input.reference) {
    return await resolveAccessibleResourceById({
      db: input.db,
      connectionId: input.connectionId,
      resourceKind: input.reference.resourceKind,
      resourceId: input.reference.resourceId,
    });
  }

  if ("externalId" in input.reference) {
    return await resolveAccessibleResourceByExternalId({
      db: input.db,
      connectionId: input.connectionId,
      resourceKind: input.reference.resourceKind,
      externalId: input.reference.externalId,
    });
  }

  return await resolveAccessibleResourceByHandle({
    db: input.db,
    connectionId: input.connectionId,
    resourceKind: input.reference.resourceKind,
    handle: input.reference.handle,
  });
}

async function resolveAccessibleResourceById(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
  resourceId: string;
}): Promise<ResolvedActorPolicyResource | undefined> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
      kind: tables.integrationConnectionResources.kind,
      externalId: tables.integrationConnectionResources.externalId,
      handle: tables.integrationConnectionResources.handle,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.resourceKind),
        eq(tables.integrationConnectionResources.id, input.resourceId),
        eq(
          tables.integrationConnectionResources.status,
          IntegrationConnectionResourceStatuses.ACCESSIBLE,
        ),
        isNull(tables.integrationConnectionResources.removedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

async function resolveAccessibleResourceByExternalId(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
  externalId: string;
}): Promise<ResolvedActorPolicyResource | undefined> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
      kind: tables.integrationConnectionResources.kind,
      externalId: tables.integrationConnectionResources.externalId,
      handle: tables.integrationConnectionResources.handle,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.resourceKind),
        eq(tables.integrationConnectionResources.externalId, input.externalId),
        eq(
          tables.integrationConnectionResources.status,
          IntegrationConnectionResourceStatuses.ACCESSIBLE,
        ),
        isNull(tables.integrationConnectionResources.removedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

async function resolveAccessibleResourceByHandle(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
  handle: string;
}): Promise<ResolvedActorPolicyResource | undefined> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
      kind: tables.integrationConnectionResources.kind,
      externalId: tables.integrationConnectionResources.externalId,
      handle: tables.integrationConnectionResources.handle,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.resourceKind),
        eq(tables.integrationConnectionResources.handle, input.handle),
        eq(
          tables.integrationConnectionResources.status,
          IntegrationConnectionResourceStatuses.ACCESSIBLE,
        ),
        isNull(tables.integrationConnectionResources.removedAt),
      ),
    )
    .limit(1);

  return rows[0];
}

async function resourceRowExists(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  reference: ActorPolicyResourceReference;
}): Promise<boolean> {
  if ("resourceId" in input.reference) {
    return await resourceRowExistsById({
      db: input.db,
      connectionId: input.connectionId,
      resourceKind: input.reference.resourceKind,
      resourceId: input.reference.resourceId,
    });
  }

  if ("externalId" in input.reference) {
    return await resourceRowExistsByExternalId({
      db: input.db,
      connectionId: input.connectionId,
      resourceKind: input.reference.resourceKind,
      externalId: input.reference.externalId,
    });
  }

  return await resourceRowExistsByHandle({
    db: input.db,
    connectionId: input.connectionId,
    resourceKind: input.reference.resourceKind,
    handle: input.reference.handle,
  });
}

async function resourceRowExistsById(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
  resourceId: string;
}): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.resourceKind),
        eq(tables.integrationConnectionResources.id, input.resourceId),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

async function resourceRowExistsByExternalId(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
  externalId: string;
}): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.resourceKind),
        eq(tables.integrationConnectionResources.externalId, input.externalId),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

async function resourceRowExistsByHandle(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
  handle: string;
}): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      id: tables.integrationConnectionResources.id,
    })
    .from(tables.integrationConnectionResources)
    .where(
      and(
        eq(tables.integrationConnectionResources.connectionId, input.connectionId),
        eq(tables.integrationConnectionResources.kind, input.resourceKind),
        eq(tables.integrationConnectionResources.handle, input.handle),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

function createSubjectRelationshipPredicate(input: {
  db: ControlPlaneDatabase;
  reference: ActorPolicyResourceReference;
  resource: ResolvedActorPolicyResource | undefined;
}): SQL | undefined {
  const tables = getControlPlaneDatabaseSchema(input.db);
  if (input.resource !== undefined) {
    const resolvedResourceIdentityPredicate = createSubjectResolvedResourceIdentityPredicate({
      db: input.db,
      resource: input.resource,
    });
    return requireSqlPredicate(
      or(
        eq(tables.integrationConnectionResourceRelationships.subjectResourceId, input.resource.id),
        and(
          isNull(tables.integrationConnectionResourceRelationships.subjectResourceId),
          resolvedResourceIdentityPredicate,
        ),
      ),
    );
  }

  if ("externalId" in input.reference) {
    return and(
      eq(
        tables.integrationConnectionResourceRelationships.subjectResourceKind,
        input.reference.resourceKind,
      ),
      eq(
        tables.integrationConnectionResourceRelationships.subjectExternalId,
        input.reference.externalId,
      ),
    );
  }

  if ("handle" in input.reference) {
    return and(
      eq(
        tables.integrationConnectionResourceRelationships.subjectResourceKind,
        input.reference.resourceKind,
      ),
      eq(tables.integrationConnectionResourceRelationships.subjectHandle, input.reference.handle),
    );
  }

  return undefined;
}

function createSubjectResolvedResourceIdentityPredicate(input: {
  db: ControlPlaneDatabase;
  resource: ResolvedActorPolicyResource;
}): SQL {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const handlePredicate = and(
    eq(tables.integrationConnectionResourceRelationships.subjectResourceKind, input.resource.kind),
    eq(tables.integrationConnectionResourceRelationships.subjectHandle, input.resource.handle),
  );
  if (input.resource.externalId === null) {
    return requireSqlPredicate(handlePredicate);
  }

  return requireSqlPredicate(
    or(
      handlePredicate,
      and(
        eq(
          tables.integrationConnectionResourceRelationships.subjectResourceKind,
          input.resource.kind,
        ),
        eq(
          tables.integrationConnectionResourceRelationships.subjectExternalId,
          input.resource.externalId,
        ),
      ),
    ),
  );
}

function createObjectRelationshipPredicate(input: {
  db: ControlPlaneDatabase;
  reference: ActorPolicyResourceReference;
  resource: ResolvedActorPolicyResource | undefined;
}): SQL | undefined {
  const tables = getControlPlaneDatabaseSchema(input.db);
  if (input.resource !== undefined) {
    const resolvedResourceIdentityPredicate = createObjectResolvedResourceIdentityPredicate({
      db: input.db,
      resource: input.resource,
    });
    return requireSqlPredicate(
      or(
        eq(tables.integrationConnectionResourceRelationships.objectResourceId, input.resource.id),
        and(
          isNull(tables.integrationConnectionResourceRelationships.objectResourceId),
          resolvedResourceIdentityPredicate,
        ),
      ),
    );
  }

  if ("externalId" in input.reference) {
    return and(
      eq(
        tables.integrationConnectionResourceRelationships.objectResourceKind,
        input.reference.resourceKind,
      ),
      eq(
        tables.integrationConnectionResourceRelationships.objectExternalId,
        input.reference.externalId,
      ),
    );
  }

  if ("handle" in input.reference) {
    return and(
      eq(
        tables.integrationConnectionResourceRelationships.objectResourceKind,
        input.reference.resourceKind,
      ),
      eq(tables.integrationConnectionResourceRelationships.objectHandle, input.reference.handle),
    );
  }

  return undefined;
}

function createObjectResolvedResourceIdentityPredicate(input: {
  db: ControlPlaneDatabase;
  resource: ResolvedActorPolicyResource;
}): SQL {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const handlePredicate = and(
    eq(tables.integrationConnectionResourceRelationships.objectResourceKind, input.resource.kind),
    eq(tables.integrationConnectionResourceRelationships.objectHandle, input.resource.handle),
  );
  if (input.resource.externalId === null) {
    return requireSqlPredicate(handlePredicate);
  }

  return requireSqlPredicate(
    or(
      handlePredicate,
      and(
        eq(
          tables.integrationConnectionResourceRelationships.objectResourceKind,
          input.resource.kind,
        ),
        eq(
          tables.integrationConnectionResourceRelationships.objectExternalId,
          input.resource.externalId,
        ),
      ),
    ),
  );
}

function requireSqlPredicate(predicate: SQL | undefined): SQL {
  if (predicate === undefined) {
    throw new Error("Expected actor policy SQL predicate to be defined.");
  }

  return predicate;
}

async function isResourceKindReadyForAttributes(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
}): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      lastSyncedAt: tables.integrationConnectionResourceStates.lastSyncedAt,
      syncState: tables.integrationConnectionResourceStates.syncState,
    })
    .from(tables.integrationConnectionResourceStates)
    .where(
      and(
        eq(tables.integrationConnectionResourceStates.connectionId, input.connectionId),
        eq(tables.integrationConnectionResourceStates.kind, input.resourceKind),
      ),
    )
    .limit(1);
  const state = rows[0];

  return (
    state !== undefined &&
    state.syncState === IntegrationConnectionResourceSyncStates.READY &&
    state.lastSyncedAt !== null
  );
}

async function isActorSetResourceKindReadyForRelationships(input: {
  db: ControlPlaneDatabase;
  connectionId: string;
  resourceKind: string;
}): Promise<boolean> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const rows = await input.db
    .select({
      lastSyncedAt: tables.integrationConnectionResourceStates.lastSyncedAt,
      syncState: tables.integrationConnectionResourceStates.syncState,
    })
    .from(tables.integrationConnectionResourceStates)
    .where(
      and(
        eq(tables.integrationConnectionResourceStates.connectionId, input.connectionId),
        eq(tables.integrationConnectionResourceStates.kind, input.resourceKind),
      ),
    )
    .limit(1);
  const state = rows[0];

  return (
    state !== undefined &&
    state.syncState === IntegrationConnectionResourceSyncStates.READY &&
    state.lastSyncedAt !== null
  );
}

function matched(): ActorPolicyQueryResult {
  return {
    state: ActorPolicyQueryResultStates.MATCHED,
  };
}

function notMatched(): ActorPolicyQueryResult {
  return {
    state: ActorPolicyQueryResultStates.NOT_MATCHED,
  };
}

function dataUnavailable(reason: string): ActorPolicyQueryResult {
  return {
    state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
    reason,
  };
}
