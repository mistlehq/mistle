/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  type IntegrationConnectionResourceStatus,
  IntegrationConnectionResourceAttributeValueTypes,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  ActorPolicyQueryResultStates,
  queryActorPolicyRelationshipScopeReadiness,
  queryActorPolicyResourceAttribute,
  queryActorPolicyResourceRelationship,
} from "../openworkflow/shared/actor-policy-query-helpers.js";

const Timestamp = "2026-03-09T00:00:00.000Z";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe.concurrent("actor policy query helpers", () => {
  it("returns explicit readiness states for relationship scopes", async ({ env }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_scope_ready",
      organizationId: "org_actor_policy_scope_ready",
      organizationSlug: "actor-policy-scope-ready",
      targetKey: "actor-policy-scope-ready",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_scope_ready",
      resources: [
        resource({
          id: "rsc_actor_policy_scope_ready_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
        }),
      ],
    });
    await seedReadyRelationshipScope({
      env,
      connectionId: "icn_actor_policy_scope_ready",
      scopeResourceId: "rsc_actor_policy_scope_ready_team",
      scopeKind: "team",
      scopeExternalId: "team_1",
      scopeHandle: "mistle/platform",
    });

    await expect(
      queryActorPolicyRelationshipScopeReadiness({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_scope_ready",
        relationshipKind: "belongs_to",
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_scope_ready_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.MATCHED,
    });

    await expect(
      queryActorPolicyRelationshipScopeReadiness({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_scope_ready",
        relationshipKind: "belongs_to",
        scope: {
          resourceKind: "team",
          handle: "mistle/backend",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
      reason: "relationship_scope_resource_unavailable",
    });
  });

  it("matches actor attributes only when actor resources and declared attribute data are ready", async ({
    env,
  }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_attribute",
      organizationId: "org_actor_policy_attribute",
      organizationSlug: "actor-policy-attribute",
      targetKey: "actor-policy-attribute",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_attribute",
      resources: [
        resource({
          id: "rsc_actor_policy_attribute_alice",
          kind: "user",
          externalId: "1001",
          handle: "alice",
          displayName: "Alice",
        }),
      ],
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_actor_policy_attribute",
        familyId: "github",
        kind: "user",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 1,
        lastSyncedAt: Timestamp,
        lastSyncStartedAt: Timestamp,
        lastSyncFinishedAt: Timestamp,
      });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceAttributes)
      .values({
        id: "ica_actor_policy_attribute_actor_type",
        connectionId: "icn_actor_policy_attribute",
        familyId: "github",
        resourceKind: "user",
        resourceExternalId: "1001",
        resourceHandle: "alice",
        attributeKey: "actor_type",
        attributeValue: "User",
        valueType: IntegrationConnectionResourceAttributeValueTypes.STRING,
        metadata: {},
        lastSeenAt: Timestamp,
      });

    await expect(
      queryActorPolicyResourceAttribute({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_attribute",
        actor: {
          resourceKind: "user",
          externalId: "1001",
        },
        attributeKey: "actor_type",
        attributeValue: "User",
        valueType: IntegrationConnectionResourceAttributeValueTypes.STRING,
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.MATCHED,
    });

    await expect(
      queryActorPolicyResourceAttribute({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_attribute",
        actor: {
          resourceKind: "user",
          externalId: "1001",
        },
        attributeKey: "actor_type",
        attributeValue: "Bot",
        valueType: IntegrationConnectionResourceAttributeValueTypes.STRING,
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.NOT_MATCHED,
    });

    await expect(
      queryActorPolicyResourceAttribute({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_attribute",
        actor: {
          resourceKind: "user",
          externalId: "1001",
        },
        attributeKey: "is_bot",
        attributeValue: "false",
        valueType: IntegrationConnectionResourceAttributeValueTypes.BOOLEAN,
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
      reason: "actor_attribute_unavailable",
    });
  });

  it("proves actor-set membership with resource id lookups and reports not matched separately", async ({
    env,
  }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_relationship",
      organizationId: "org_actor_policy_relationship",
      organizationSlug: "actor-policy-relationship",
      targetKey: "actor-policy-relationship",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_relationship",
      resources: [
        resource({
          id: "rsc_actor_policy_relationship_alice",
          kind: "user",
          externalId: "1001",
          handle: "alice",
          displayName: "Alice",
        }),
        resource({
          id: "rsc_actor_policy_relationship_bob",
          kind: "user",
          externalId: "1002",
          handle: "bob",
          displayName: "Bob",
        }),
        resource({
          id: "rsc_actor_policy_relationship_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
        }),
      ],
    });
    await seedReadyRelationshipScope({
      env,
      connectionId: "icn_actor_policy_relationship",
      scopeResourceId: "rsc_actor_policy_relationship_team",
      scopeKind: "team",
      scopeExternalId: "team_1",
      scopeHandle: "mistle/platform",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceRelationships)
      .values({
        id: "irr_actor_policy_relationship_alice_team",
        connectionId: "icn_actor_policy_relationship",
        familyId: "github",
        relationshipKind: "belongs_to",
        subjectResourceId: "rsc_actor_policy_relationship_alice",
        subjectResourceKind: "user",
        subjectExternalId: "1001",
        subjectHandle: "alice",
        objectResourceId: "rsc_actor_policy_relationship_team",
        objectResourceKind: "team",
        objectExternalId: "team_1",
        objectHandle: "mistle/platform",
        scopeResourceId: "rsc_actor_policy_relationship_team",
        scopeKind: "team",
        scopeExternalId: "team_1",
        scopeHandle: "mistle/platform",
        metadata: {},
        lastSeenAt: Timestamp,
      });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          resourceId: "rsc_actor_policy_relationship_alice",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.MATCHED,
    });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          resourceId: "rsc_actor_policy_relationship_bob",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.NOT_MATCHED,
    });
  });

  it("matches relationships by provider identity when resource rows are synced after relationship rows", async ({
    env,
  }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_relationship_late_resources",
      organizationId: "org_actor_policy_relationship_late_resources",
      organizationSlug: "actor-policy-relationship-late-resources",
      targetKey: "actor-policy-relationship-late-resources",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_relationship_late_resources",
      resources: [
        resource({
          id: "rsc_actor_policy_relationship_late_resources_alice",
          kind: "user",
          externalId: "1001",
          handle: "alice",
          displayName: "Alice",
        }),
        resource({
          id: "rsc_actor_policy_relationship_late_resources_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
        }),
      ],
    });
    await seedReadyRelationshipScope({
      env,
      connectionId: "icn_actor_policy_relationship_late_resources",
      scopeResourceId: "rsc_actor_policy_relationship_late_resources_team",
      scopeKind: "team",
      scopeExternalId: "team_1",
      scopeHandle: "mistle/platform",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceRelationships)
      .values({
        id: "irr_actor_policy_relationship_late_resources_alice_team",
        connectionId: "icn_actor_policy_relationship_late_resources",
        familyId: "github",
        relationshipKind: "belongs_to",
        subjectResourceId: null,
        subjectResourceKind: "user",
        subjectExternalId: "1001",
        subjectHandle: "alice",
        objectResourceId: null,
        objectResourceKind: "team",
        objectExternalId: "team_1",
        objectHandle: "mistle/platform",
        scopeResourceId: "rsc_actor_policy_relationship_late_resources_team",
        scopeKind: "team",
        scopeExternalId: "team_1",
        scopeHandle: "mistle/platform",
        metadata: {},
        lastSeenAt: Timestamp,
      });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship_late_resources",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          resourceId: "rsc_actor_policy_relationship_late_resources_alice",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_late_resources_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_late_resources_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.MATCHED,
    });
  });

  it("uses provider identity columns for relationship subjects without resource rows", async ({
    env,
  }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_relationship_external_subject",
      organizationId: "org_actor_policy_relationship_external_subject",
      organizationSlug: "actor-policy-relationship-external-subject",
      targetKey: "actor-policy-relationship-external-subject",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_relationship_external_subject",
      resources: [
        resource({
          id: "rsc_actor_policy_relationship_external_subject_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
        }),
      ],
    });
    await seedReadyRelationshipScope({
      env,
      connectionId: "icn_actor_policy_relationship_external_subject",
      scopeResourceId: "rsc_actor_policy_relationship_external_subject_team",
      scopeKind: "team",
      scopeExternalId: "team_1",
      scopeHandle: "mistle/platform",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceRelationships)
      .values({
        id: "irr_actor_policy_relationship_external_subject_alice_team",
        connectionId: "icn_actor_policy_relationship_external_subject",
        familyId: "github",
        relationshipKind: "belongs_to",
        subjectResourceId: null,
        subjectResourceKind: "user",
        subjectExternalId: "1001",
        subjectHandle: "alice",
        objectResourceId: "rsc_actor_policy_relationship_external_subject_team",
        objectResourceKind: "team",
        objectExternalId: "team_1",
        objectHandle: "mistle/platform",
        scopeResourceId: "rsc_actor_policy_relationship_external_subject_team",
        scopeKind: "team",
        scopeExternalId: "team_1",
        scopeHandle: "mistle/platform",
        metadata: {},
        lastSeenAt: Timestamp,
      });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship_external_subject",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          externalId: "1001",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_external_subject_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_external_subject_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.MATCHED,
    });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship_external_subject",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          externalId: "1002",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_external_subject_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_external_subject_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.NOT_MATCHED,
    });
  });

  it("does not use provider identity columns when a matching actor resource is unavailable", async ({
    env,
  }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_relationship_unavailable_actor",
      organizationId: "org_actor_policy_relationship_unavailable_actor",
      organizationSlug: "actor-policy-relationship-unavailable-actor",
      targetKey: "actor-policy-relationship-unavailable-actor",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_relationship_unavailable_actor",
      resources: [
        resource({
          id: "rsc_actor_policy_relationship_unavailable_actor_alice",
          kind: "user",
          externalId: "1001",
          handle: "alice",
          displayName: "Alice",
          status: IntegrationConnectionResourceStatuses.UNAVAILABLE,
        }),
        resource({
          id: "rsc_actor_policy_relationship_unavailable_actor_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
        }),
      ],
    });
    await seedReadyRelationshipScope({
      env,
      connectionId: "icn_actor_policy_relationship_unavailable_actor",
      scopeResourceId: "rsc_actor_policy_relationship_unavailable_actor_team",
      scopeKind: "team",
      scopeExternalId: "team_1",
      scopeHandle: "mistle/platform",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceRelationships)
      .values({
        id: "irr_actor_policy_relationship_unavailable_actor_alice_team",
        connectionId: "icn_actor_policy_relationship_unavailable_actor",
        familyId: "github",
        relationshipKind: "belongs_to",
        subjectResourceId: null,
        subjectResourceKind: "user",
        subjectExternalId: "1001",
        subjectHandle: "alice",
        objectResourceId: "rsc_actor_policy_relationship_unavailable_actor_team",
        objectResourceKind: "team",
        objectExternalId: "team_1",
        objectHandle: "mistle/platform",
        scopeResourceId: "rsc_actor_policy_relationship_unavailable_actor_team",
        scopeKind: "team",
        scopeExternalId: "team_1",
        scopeHandle: "mistle/platform",
        metadata: {},
        lastSeenAt: Timestamp,
      });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship_unavailable_actor",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          externalId: "1001",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_unavailable_actor_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_unavailable_actor_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
      reason: "actor_resource_unavailable",
    });
  });

  it("does not use provider identity columns when a matching actor-set resource is unavailable", async ({
    env,
  }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_relationship_unavailable_actor_set",
      organizationId: "org_actor_policy_relationship_unavailable_actor_set",
      organizationSlug: "actor-policy-relationship-unavailable-actor-set",
      targetKey: "actor-policy-relationship-unavailable-actor-set",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_relationship_unavailable_actor_set",
      resources: [
        resource({
          id: "rsc_actor_policy_relationship_unavailable_actor_set_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
          status: IntegrationConnectionResourceStatuses.UNAVAILABLE,
        }),
        resource({
          id: "rsc_actor_policy_relationship_unavailable_actor_set_org",
          kind: "org",
          externalId: "org_1",
          handle: "mistle",
          displayName: "Mistle",
        }),
      ],
    });
    await seedReadyRelationshipScope({
      env,
      connectionId: "icn_actor_policy_relationship_unavailable_actor_set",
      scopeResourceId: "rsc_actor_policy_relationship_unavailable_actor_set_org",
      scopeKind: "org",
      scopeExternalId: "org_1",
      scopeHandle: "mistle",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceRelationships)
      .values({
        id: "irr_actor_policy_relationship_unavailable_actor_set_alice_team",
        connectionId: "icn_actor_policy_relationship_unavailable_actor_set",
        familyId: "github",
        relationshipKind: "belongs_to",
        subjectResourceId: null,
        subjectResourceKind: "user",
        subjectExternalId: "1001",
        subjectHandle: "alice",
        objectResourceId: null,
        objectResourceKind: "team",
        objectExternalId: "team_1",
        objectHandle: "mistle/platform",
        scopeResourceId: "rsc_actor_policy_relationship_unavailable_actor_set_org",
        scopeKind: "org",
        scopeExternalId: "org_1",
        scopeHandle: "mistle",
        metadata: {},
        lastSeenAt: Timestamp,
      });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship_unavailable_actor_set",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          externalId: "1001",
        },
        actorSet: {
          resourceKind: "team",
          externalId: "team_1",
        },
        scope: {
          resourceKind: "org",
          resourceId: "rsc_actor_policy_relationship_unavailable_actor_set_org",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
      reason: "actor_set_resource_unavailable",
    });
  });

  it("does not answer membership when the relationship scope is not ready", async ({ env }) => {
    await seedConnection({
      env,
      connectionId: "icn_actor_policy_relationship_unready",
      organizationId: "org_actor_policy_relationship_unready",
      organizationSlug: "actor-policy-relationship-unready",
      targetKey: "actor-policy-relationship-unready",
    });
    await seedResources({
      env,
      connectionId: "icn_actor_policy_relationship_unready",
      resources: [
        resource({
          id: "rsc_actor_policy_relationship_unready_alice",
          kind: "user",
          externalId: "1001",
          handle: "alice",
          displayName: "Alice",
        }),
        resource({
          id: "rsc_actor_policy_relationship_unready_team",
          kind: "team",
          externalId: "team_1",
          handle: "mistle/platform",
          displayName: "Platform",
        }),
      ],
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_actor_policy_relationship_unready",
        familyId: "github",
        kind: "team",
        syncState: IntegrationConnectionResourceSyncStates.ERROR,
        totalCount: 0,
        lastSyncStartedAt: Timestamp,
        lastSyncFinishedAt: Timestamp,
        lastErrorCode: "PROVIDER_ERROR",
        lastErrorMessage: "provider denied membership listing",
      });

    await expect(
      queryActorPolicyResourceRelationship({
        db: env.controlPlaneDb,
        connectionId: "icn_actor_policy_relationship_unready",
        relationshipKind: "belongs_to",
        actor: {
          resourceKind: "user",
          resourceId: "rsc_actor_policy_relationship_unready_alice",
        },
        actorSet: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_unready_team",
        },
        scope: {
          resourceKind: "team",
          resourceId: "rsc_actor_policy_relationship_unready_team",
        },
      }),
    ).resolves.toEqual({
      state: ActorPolicyQueryResultStates.DATA_UNAVAILABLE,
      reason: "relationship_scope_not_ready",
    });
  });
});

async function seedConnection(input: {
  env: IntegrationTestEnvironment;
  connectionId: string;
  organizationId: string;
  organizationSlug: string;
  targetKey: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationSlug,
    slug: input.organizationSlug,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: input.organizationSlug,
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "123456",
      },
    });
}

async function seedReadyRelationshipScope(input: {
  env: IntegrationTestEnvironment;
  connectionId: string;
  scopeResourceId: string;
  scopeKind: string;
  scopeExternalId: string;
  scopeHandle: string;
}): Promise<void> {
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnectionResourceStates)
    .values({
      connectionId: input.connectionId,
      familyId: "github",
      kind: input.scopeKind,
      syncState: IntegrationConnectionResourceSyncStates.READY,
      totalCount: 1,
      lastSyncedAt: Timestamp,
      lastSyncStartedAt: Timestamp,
      lastSyncFinishedAt: Timestamp,
    });
}

async function seedResources(input: {
  env: IntegrationTestEnvironment;
  connectionId: string;
  resources: ReadonlyArray<ReturnType<typeof resource>>;
}): Promise<void> {
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnectionResources)
    .values(
      input.resources.map((entry) => ({
        ...entry,
        connectionId: input.connectionId,
        familyId: "github",
      })),
    );
}

function resource(input: {
  id: string;
  kind: string;
  externalId: string;
  handle: string;
  displayName: string;
  status?: IntegrationConnectionResourceStatus;
}) {
  return {
    id: input.id,
    kind: input.kind,
    externalId: input.externalId,
    handle: input.handle,
    displayName: input.displayName,
    status: input.status ?? IntegrationConnectionResourceStatuses.ACCESSIBLE,
    metadata: {},
    lastSeenAt: Timestamp,
    removedAt: null,
  };
}
