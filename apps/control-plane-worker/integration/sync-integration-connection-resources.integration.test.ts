/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import type {
  AnyIntegrationDefinition,
  DiscoveredIntegrationResource,
  DiscoveredIntegrationResourceAttribute,
  DiscoveredIntegrationResourceRelationship,
  IntegrationResourceAttributeDefinition,
} from "@mistle/integrations-core";
import { IntegrationKinds, IntegrationRegistry } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
  TestEnvironmentIdHeader,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { applySuccessfulResourceSync } from "../openworkflow/sync-integration-connection-resources/apply-successful-resource-sync.js";
import { markResourceSyncing } from "../openworkflow/sync-integration-connection-resources/mark-resource-syncing.js";
import { syncIntegrationConnectionResources } from "../openworkflow/sync-integration-connection-resources/sync-integration-connection-resources.js";

const InternalServiceToken = "integration-new-internal-service-token";
const SlackAppId = "A0123456789";
const UserAttributeDefinitions: ReadonlyArray<IntegrationResourceAttributeDefinition> = [
  {
    key: "is_bot",
    valueType: "boolean",
    actorPolicyEligible: true,
  },
  {
    key: "actor_type",
    valueType: "string",
  },
];

const it = createIntegrationTest({
  services: ["control-plane-api", "control-plane-worker"],
  extraInfra: ["mailpit"],
});

describe.concurrent("sync integration connection resources", () => {
  it("marks sync state as error and preserves the last snapshot when credential resolution is unavailable", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resources_missing_listing",
      targetKey: "github-cloud-sync-resources-missing-listing",
      connectionId: "icn_sync_resources_missing_listing",
      organizationName: "Sync Resources Missing Listing",
      organizationSlug: "sync-resources-missing-listing",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values({
        connectionId: "icn_sync_resources_missing_listing",
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 1,
        lastSyncedAt: "2026-03-09T00:00:00.000Z",
        lastSyncStartedAt: "2026-03-09T00:01:00.000Z",
        lastSyncFinishedAt: "2026-03-09T00:01:30.000Z",
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values({
      id: "rsc_sync_resources_missing_listing",
      connectionId: "icn_sync_resources_missing_listing",
      familyId: "github",
      kind: "repository",
      externalId: "1",
      handle: "mistlehq/demo",
      displayName: "mistlehq/demo",
      status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
      metadata: {
        defaultBranch: "main",
      },
      lastSeenAt: "2026-03-09T00:00:00.000Z",
    });

    await expect(
      syncIntegrationConnectionResources(
        {
          db: env.controlPlaneDb,
          integrationRegistry: createIntegrationRegistry(),
        },
        {
          organizationId: "org_sync_resources_missing_listing",
          connectionId: "icn_sync_resources_missing_listing",
          kind: "repository",
        },
      ),
    ).rejects.toThrow("Resource sync credential resolution is not configured.");

    const persistedState =
      await env.controlPlaneDb.query.integrationConnectionResourceStates.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resources_missing_listing"),
            eq(table.kind, "repository"),
          ),
      });
    expect(persistedState).toBeDefined();
    if (persistedState === undefined) {
      throw new Error("Expected persisted resource sync state.");
    }

    expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.ERROR);
    expect(persistedState.totalCount).toBe(1);
    expect(new Date(persistedState.lastSyncedAt ?? "").toISOString()).toBe(
      "2026-03-09T00:00:00.000Z",
    );
    expect(persistedState.lastSyncFinishedAt).toBeTruthy();
    expect(persistedState.lastErrorCode).toBe("resource_sync_failed");
    expect(persistedState.lastErrorMessage).toContain(
      "Resource sync credential resolution is not configured.",
    );

    const persistedResources =
      await env.controlPlaneDb.query.integrationConnectionResources.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resources_missing_listing"),
            eq(table.kind, "repository"),
          ),
      });
    expect(persistedResources).toHaveLength(1);
    expect(persistedResources[0]).toEqual(
      expect.objectContaining({
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        handle: "mistlehq/demo",
        removedAt: null,
        metadata: {
          defaultBranch: "main",
        },
      }),
    );
  });

  it("syncs Slack public channel resources through the real control-plane credential resolver", async ({
    env,
  }) => {
    const slackApi = await startSimulatedSlackApi();

    try {
      const slackConnection = await createSlackConnection({
        env,
        targetKey: "slack-default-sync-resources-channel",
        connectionName: "Slack Sync Resources Channel",
        apiBaseUrl: `${slackApi.baseUrl}/api`,
        email: "integration-new-sync-resources-slack@example.com",
      });

      await expect(
        syncIntegrationConnectionResources(
          {
            db: env.controlPlaneDb,
            integrationRegistry: createIntegrationRegistry(),
            controlPlaneInternalClient: createControlPlaneInternalClient(env),
          },
          {
            organizationId: slackConnection.organizationId,
            connectionId: slackConnection.connectionId,
            kind: "channel",
          },
        ),
      ).resolves.toEqual({
        organizationId: slackConnection.organizationId,
        connectionId: slackConnection.connectionId,
        kind: "channel",
      });

      const persistedState =
        await env.controlPlaneDb.query.integrationConnectionResourceStates.findFirst({
          where: (table, { and, eq }) =>
            and(eq(table.connectionId, slackConnection.connectionId), eq(table.kind, "channel")),
        });
      expect(persistedState).toBeDefined();
      if (persistedState === undefined) {
        throw new Error("Expected persisted Slack resource sync state.");
      }

      expect(persistedState.syncState).toBe(IntegrationConnectionResourceSyncStates.READY);
      expect(persistedState.totalCount).toBe(1);
      expect(persistedState.lastSyncedAt).toBeTruthy();
      expect(persistedState.lastErrorCode).toBeNull();
      expect(persistedState.lastErrorMessage).toBeNull();

      const persistedResources =
        await env.controlPlaneDb.query.integrationConnectionResources.findMany({
          where: (table, { and, eq }) =>
            and(eq(table.connectionId, slackConnection.connectionId), eq(table.kind, "channel")),
        });
      expect(persistedResources).toHaveLength(1);
      expect(persistedResources[0]).toEqual(
        expect.objectContaining({
          externalId: "C12345678",
          handle: "C12345678",
          displayName: "#alerts",
          status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
          removedAt: null,
          metadata: {
            name: "alerts",
            isPrivate: false,
            isArchived: false,
            isShared: false,
            isExtShared: false,
            isIm: false,
            isMpim: false,
            isChannel: true,
            isGroup: false,
          },
        }),
      );
    } finally {
      await slackApi.stop();
    }
  });

  it("ignores an older successful snapshot after a newer sync has already started", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resources_stale_snapshot",
      targetKey: "github-cloud-sync-resources-stale-snapshot",
      connectionId: "icn_sync_resources_stale_snapshot",
      organizationName: "Sync Resources Stale Snapshot",
      organizationSlug: "sync-resources-stale-snapshot",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values({
      id: "rsc_sync_resources_stale_snapshot_existing",
      connectionId: "icn_sync_resources_stale_snapshot",
      familyId: "github",
      kind: "repository",
      externalId: "1",
      handle: "mistlehq/existing",
      displayName: "mistlehq/existing",
      status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
      metadata: {
        defaultBranch: "main",
      },
      lastSeenAt: "2026-03-09T00:00:00.000Z",
    });

    const firstSyncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resources_stale_snapshot",
      familyId: "github",
      kind: "repository",
    });
    const secondSyncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resources_stale_snapshot",
      familyId: "github",
      kind: "repository",
    });

    expect(secondSyncStartedAt).not.toBe(firstSyncStartedAt);

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resources_stale_snapshot",
        familyId: "github",
        kind: "repository",
        syncStartedAt: secondSyncStartedAt,
        discoveredResources: [
          {
            externalId: "1",
            handle: "mistlehq/existing",
            displayName: "mistlehq/existing",
            metadata: {
              defaultBranch: "main",
            },
          },
          {
            externalId: "2",
            handle: "mistlehq/new",
            displayName: "mistlehq/new",
            metadata: {
              defaultBranch: "develop",
            },
          },
        ],
      }),
    ).resolves.toBe(true);

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resources_stale_snapshot",
        familyId: "github",
        kind: "repository",
        syncStartedAt: firstSyncStartedAt,
        discoveredResources: [
          {
            externalId: "1",
            handle: "mistlehq/existing",
            displayName: "mistlehq/existing",
            metadata: {
              defaultBranch: "main",
            },
          },
        ],
      }),
    ).resolves.toBe(false);

    const persistedState =
      await env.controlPlaneDb.query.integrationConnectionResourceStates.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resources_stale_snapshot"),
            eq(table.kind, "repository"),
          ),
      });
    expect(persistedState?.syncState).toBe(IntegrationConnectionResourceSyncStates.READY);
    expect(persistedState?.totalCount).toBe(2);

    const persistedResources =
      await env.controlPlaneDb.query.integrationConnectionResources.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resources_stale_snapshot"),
            eq(table.kind, "repository"),
          ),
        orderBy: (table, { asc }) => [asc(table.handle)],
      });
    expect(
      persistedResources.map((resource) => ({
        handle: resource.handle,
        status: resource.status,
        removedAt: resource.removedAt,
      })),
    ).toEqual([
      {
        handle: "mistlehq/existing",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        removedAt: null,
      },
      {
        handle: "mistlehq/new",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        removedAt: null,
      },
    ]);
  });

  it("persists new resource attributes and updates changed values in a successful snapshot", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_upsert",
      targetKey: "github-cloud-sync-resource-attributes-upsert",
      connectionId: "icn_sync_resource_attributes_upsert",
      organizationName: "Sync Resource Attributes Upsert",
      organizationSlug: "sync-resource-attributes-upsert",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values({
      id: "rsc_sync_resource_attributes_upsert_alice",
      connectionId: "icn_sync_resource_attributes_upsert",
      familyId: "github",
      kind: "user",
      externalId: "1",
      handle: "alice",
      displayName: "Alice",
      status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
      metadata: {},
      lastSeenAt: "2026-03-09T00:00:00.000Z",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceAttributes)
      .values({
        id: "ica_sync_resource_attributes_upsert_is_bot",
        connectionId: "icn_sync_resource_attributes_upsert",
        familyId: "github",
        resourceKind: "user",
        resourceExternalId: "1",
        resourceHandle: "alice",
        attributeKey: "is_bot",
        attributeValue: "true",
        valueType: "boolean",
        metadata: {
          source: "old",
        },
        lastSeenAt: "2026-03-09T00:00:00.000Z",
      });

    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_upsert",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_upsert",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice Updated",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {
              source: "new",
            },
          }),
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "actor_type",
            value: "User",
            valueType: "string",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).resolves.toBe(true);

    const persistedAttributes =
      await env.controlPlaneDb.query.integrationConnectionResourceAttributes.findMany({
        where: (table, { eq }) => eq(table.connectionId, "icn_sync_resource_attributes_upsert"),
        orderBy: (table, { asc }) => [asc(table.attributeKey)],
      });
    expect(
      persistedAttributes.map((attribute) => ({
        resourceExternalId: attribute.resourceExternalId,
        resourceHandle: attribute.resourceHandle,
        attributeKey: attribute.attributeKey,
        attributeValue: attribute.attributeValue,
        valueType: attribute.valueType,
        metadata: attribute.metadata,
        removedAt: attribute.removedAt,
      })),
    ).toEqual([
      {
        resourceExternalId: "1",
        resourceHandle: "alice",
        attributeKey: "actor_type",
        attributeValue: "User",
        valueType: "string",
        metadata: {},
        removedAt: null,
      },
      {
        resourceExternalId: "1",
        resourceHandle: "alice",
        attributeKey: "is_bot",
        attributeValue: "false",
        valueType: "boolean",
        metadata: {
          source: "new",
        },
        removedAt: null,
      },
    ]);
  });

  it("keeps attribute-bearing accessible resources available when they are not in the resource snapshot", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_existing_resource",
      targetKey: "github-cloud-sync-resource-attributes-existing-resource",
      connectionId: "icn_sync_resource_attributes_existing_resource",
      organizationName: "Sync Resource Attributes Existing Resource",
      organizationSlug: "sync-resource-attributes-existing-resource",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values({
      id: "rsc_sync_resource_attributes_existing_resource_bob",
      connectionId: "icn_sync_resource_attributes_existing_resource",
      familyId: "github",
      kind: "user",
      externalId: "2",
      handle: "bob",
      displayName: "Bob",
      status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
      metadata: {},
      lastSeenAt: "2026-03-09T00:00:00.000Z",
    });
    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_existing_resource",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_existing_resource",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {},
          }),
          githubUserAttribute({
            resourceExternalId: "2",
            resourceHandle: "bob",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).resolves.toBe(true);

    const persistedAttribute =
      await env.controlPlaneDb.query.integrationConnectionResourceAttributes.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resource_attributes_existing_resource"),
            eq(table.resourceHandle, "bob"),
            eq(table.attributeKey, "is_bot"),
          ),
      });
    expect(persistedAttribute).toEqual(
      expect.objectContaining({
        resourceExternalId: "2",
        attributeValue: "false",
        removedAt: null,
      }),
    );

    const persistedResource =
      await env.controlPlaneDb.query.integrationConnectionResources.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resource_attributes_existing_resource"),
            eq(table.handle, "bob"),
          ),
      });
    expect(persistedResource).toEqual(
      expect.objectContaining({
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        removedAt: null,
      }),
    );
  });

  it("marks unseen declared attributes removed without touching unrelated attributes", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_stale_cleanup",
      targetKey: "github-cloud-sync-resource-attributes-stale-cleanup",
      connectionId: "icn_sync_resource_attributes_stale_cleanup",
      organizationName: "Sync Resource Attributes Stale Cleanup",
      organizationSlug: "sync-resource-attributes-stale-cleanup",
    });
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_unrelated",
      targetKey: "github-cloud-sync-resource-attributes-unrelated",
      connectionId: "icn_sync_resource_attributes_unrelated",
      organizationName: "Sync Resource Attributes Unrelated",
      organizationSlug: "sync-resource-attributes-unrelated",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values([
      {
        id: "rsc_sync_resource_attributes_stale_cleanup_alice",
        connectionId: "icn_sync_resource_attributes_stale_cleanup",
        familyId: "github",
        kind: "user",
        externalId: "1",
        handle: "alice",
        displayName: "Alice",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: {},
        lastSeenAt: "2026-03-09T00:00:00.000Z",
      },
      {
        id: "rsc_sync_resource_attributes_stale_cleanup_bob",
        connectionId: "icn_sync_resource_attributes_stale_cleanup",
        familyId: "github",
        kind: "user",
        externalId: "2",
        handle: "bob",
        displayName: "Bob",
        status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
        metadata: {},
        lastSeenAt: "2026-03-09T00:00:00.000Z",
      },
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceAttributes)
      .values([
        persistedAttribute({
          id: "ica_sync_resource_attributes_stale_cleanup_alice_is_bot",
          connectionId: "icn_sync_resource_attributes_stale_cleanup",
          resourceExternalId: "1",
          resourceHandle: "alice",
          attributeKey: "is_bot",
          attributeValue: "false",
          valueType: "boolean",
        }),
        persistedAttribute({
          id: "ica_sync_resource_attributes_stale_cleanup_bob_is_bot",
          connectionId: "icn_sync_resource_attributes_stale_cleanup",
          resourceExternalId: "2",
          resourceHandle: "bob",
          attributeKey: "is_bot",
          attributeValue: "false",
          valueType: "boolean",
        }),
        persistedAttribute({
          id: "ica_sync_resource_attributes_stale_cleanup_bob_actor_type",
          connectionId: "icn_sync_resource_attributes_stale_cleanup",
          resourceExternalId: "2",
          resourceHandle: "bob",
          attributeKey: "actor_type",
          attributeValue: "User",
          valueType: "string",
        }),
        persistedAttribute({
          id: "ica_sync_resource_attributes_unrelated_is_bot",
          connectionId: "icn_sync_resource_attributes_unrelated",
          resourceExternalId: "1",
          resourceHandle: "alice",
          attributeKey: "is_bot",
          attributeValue: "false",
          valueType: "boolean",
        }),
      ]);

    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_stale_cleanup",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_stale_cleanup",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {},
          }),
        ],
        attributeDefinitions: [
          {
            key: "is_bot",
            valueType: "boolean",
            actorPolicyEligible: true,
          },
        ],
      }),
    ).resolves.toBe(true);

    const persistedAttributes =
      await env.controlPlaneDb.query.integrationConnectionResourceAttributes.findMany({
        where: (table, { inArray }) =>
          inArray(table.id, [
            "ica_sync_resource_attributes_stale_cleanup_alice_is_bot",
            "ica_sync_resource_attributes_stale_cleanup_bob_is_bot",
            "ica_sync_resource_attributes_stale_cleanup_bob_actor_type",
            "ica_sync_resource_attributes_unrelated_is_bot",
          ]),
        orderBy: (table, { asc }) => [asc(table.id)],
      });
    expect(
      persistedAttributes.map((attribute) => ({
        id: attribute.id,
        removed: attribute.removedAt !== null,
      })),
    ).toEqual([
      {
        id: "ica_sync_resource_attributes_stale_cleanup_alice_is_bot",
        removed: false,
      },
      {
        id: "ica_sync_resource_attributes_stale_cleanup_bob_actor_type",
        removed: false,
      },
      {
        id: "ica_sync_resource_attributes_stale_cleanup_bob_is_bot",
        removed: true,
      },
      {
        id: "ica_sync_resource_attributes_unrelated_is_bot",
        removed: false,
      },
    ]);
  });

  it("rejects resource attributes whose resource is neither in the snapshot nor currently accessible", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_orphan",
      targetKey: "github-cloud-sync-resource-attributes-orphan",
      connectionId: "icn_sync_resource_attributes_orphan",
      organizationName: "Sync Resource Attributes Orphan",
      organizationSlug: "sync-resource-attributes-orphan",
    });
    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_orphan",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_orphan",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "404",
            resourceHandle: "ghost",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).rejects.toThrow("Provider returned attribute 'is_bot' for unknown resource 'ghost'.");

    const persistedAttributes =
      await env.controlPlaneDb.query.integrationConnectionResourceAttributes.findMany({
        where: (table, { eq }) => eq(table.connectionId, "icn_sync_resource_attributes_orphan"),
      });
    expect(persistedAttributes).toEqual([]);
  });

  it("rejects successful snapshots that omit declared actor-policy attributes", async ({ env }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_missing_actor_policy",
      targetKey: "github-cloud-sync-resource-attributes-missing-actor-policy",
      connectionId: "icn_sync_resource_attributes_missing_actor_policy",
      organizationName: "Sync Resource Attributes Missing Actor Policy",
      organizationSlug: "sync-resource-attributes-missing-actor-policy",
    });
    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_missing_actor_policy",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_missing_actor_policy",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "actor_type",
            value: "User",
            valueType: "string",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).rejects.toThrow("Provider omitted actor-policy attribute 'is_bot' for resource 'alice'.");
  });

  it("rejects resource attributes whose value type does not match the declaration", async ({
    env,
  }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_wrong_value_type",
      targetKey: "github-cloud-sync-resource-attributes-wrong-value-type",
      connectionId: "icn_sync_resource_attributes_wrong_value_type",
      organizationName: "Sync Resource Attributes Wrong Value Type",
      organizationSlug: "sync-resource-attributes-wrong-value-type",
    });
    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_wrong_value_type",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_wrong_value_type",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "false",
            valueType: "string",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).rejects.toThrow(
      "Provider returned attribute 'is_bot' with value type 'string' but declared 'boolean'.",
    );
  });

  it("rejects resource attributes with non-canonical boolean values", async ({ env }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_noncanonical_boolean",
      targetKey: "github-cloud-sync-resource-attributes-noncanonical-boolean",
      connectionId: "icn_sync_resource_attributes_noncanonical_boolean",
      organizationName: "Sync Resource Attributes Noncanonical Boolean",
      organizationSlug: "sync-resource-attributes-noncanonical-boolean",
    });
    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_noncanonical_boolean",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_noncanonical_boolean",
        familyId: "github",
        kind: "user",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "False",
            valueType: "boolean",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).rejects.toThrow(
      "Provider returned boolean attribute 'is_bot' with non-canonical value 'False'.",
    );
  });

  it("does not mutate attributes when a stale successful snapshot is ignored", async ({ env }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resource_attributes_stale_snapshot",
      targetKey: "github-cloud-sync-resource-attributes-stale-snapshot",
      connectionId: "icn_sync_resource_attributes_stale_snapshot",
      organizationName: "Sync Resource Attributes Stale Snapshot",
      organizationSlug: "sync-resource-attributes-stale-snapshot",
    });

    const firstSyncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_stale_snapshot",
      familyId: "github",
      kind: "user",
    });
    const secondSyncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resource_attributes_stale_snapshot",
      familyId: "github",
      kind: "user",
    });

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_stale_snapshot",
        familyId: "github",
        kind: "user",
        syncStartedAt: secondSyncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "false",
            valueType: "boolean",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).resolves.toBe(true);

    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resource_attributes_stale_snapshot",
        familyId: "github",
        kind: "user",
        syncStartedAt: firstSyncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "1",
            handle: "alice",
            displayName: "Alice",
          }),
        ],
        discoveredAttributes: [
          githubUserAttribute({
            resourceExternalId: "1",
            resourceHandle: "alice",
            key: "is_bot",
            value: "true",
            valueType: "boolean",
            metadata: {},
          }),
        ],
        attributeDefinitions: UserAttributeDefinitions,
      }),
    ).resolves.toBe(false);

    const persistedAttribute =
      await env.controlPlaneDb.query.integrationConnectionResourceAttributes.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resource_attributes_stale_snapshot"),
            eq(table.resourceHandle, "alice"),
            eq(table.attributeKey, "is_bot"),
          ),
      });
    expect(persistedAttribute?.attributeValue).toBe("false");
  });

  it("persists attributes returned by the integration resource sync workflow", async ({ env }) => {
    await seedAttributeProviderConnection({ env });
    const registry = createAttributeProviderRegistry();

    await expect(
      syncIntegrationConnectionResources(
        {
          db: env.controlPlaneDb,
          integrationRegistry: registry,
        },
        {
          organizationId: "org_sync_resource_attributes_workflow",
          connectionId: "icn_sync_resource_attributes_workflow",
          kind: "user",
        },
      ),
    ).resolves.toEqual({
      organizationId: "org_sync_resource_attributes_workflow",
      connectionId: "icn_sync_resource_attributes_workflow",
      kind: "user",
    });

    const persistedAttribute =
      await env.controlPlaneDb.query.integrationConnectionResourceAttributes.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.connectionId, "icn_sync_resource_attributes_workflow"),
            eq(table.resourceHandle, "alice"),
            eq(table.attributeKey, "is_bot"),
          ),
      });
    expect(persistedAttribute).toEqual(
      expect.objectContaining({
        familyId: "attribute-test",
        resourceKind: "user",
        resourceExternalId: "1",
        attributeValue: "false",
        valueType: "boolean",
        metadata: {
          source: "workflow",
        },
        removedAt: null,
      }),
    );
  });

  it("persists relationship snapshots returned by resource sync", async ({ env }) => {
    await seedGitHubConnection({
      env,
      organizationId: "org_sync_resources_relationship_snapshot",
      targetKey: "github-cloud-sync-resources-relationship-snapshot",
      connectionId: "icn_sync_resources_relationship_snapshot",
      organizationName: "Sync Resources Relationship Snapshot",
      organizationSlug: "sync-resources-relationship-snapshot",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnectionResources).values([
      persistedResource({
        id: "rsc_sync_resources_relationship_snapshot_alice",
        connectionId: "icn_sync_resources_relationship_snapshot",
        kind: "user",
        externalId: "1",
        handle: "alice",
        displayName: "Alice",
      }),
      persistedResource({
        id: "rsc_sync_resources_relationship_snapshot_bob",
        connectionId: "icn_sync_resources_relationship_snapshot",
        kind: "user",
        externalId: "2",
        handle: "bob",
        displayName: "Bob",
      }),
      persistedResource({
        id: "rsc_sync_resources_relationship_snapshot_carla",
        connectionId: "icn_sync_resources_relationship_snapshot",
        kind: "user",
        externalId: "3",
        handle: "carla",
        displayName: "Carla",
      }),
      persistedResource({
        id: "rsc_sync_resources_relationship_snapshot_team",
        connectionId: "icn_sync_resources_relationship_snapshot",
        kind: "team",
        externalId: "100",
        handle: "mistle/backend",
        displayName: "Backend",
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceRelationships)
      .values([
        {
          id: "irr_sync_resources_relationship_snapshot_bob",
          connectionId: "icn_sync_resources_relationship_snapshot",
          familyId: "github",
          relationshipKind: "belongs_to",
          subjectResourceId: "rsc_sync_resources_relationship_snapshot_bob",
          subjectResourceKind: "user",
          subjectExternalId: "2",
          subjectHandle: "bob",
          objectResourceId: "rsc_sync_resources_relationship_snapshot_team",
          objectResourceKind: "team",
          objectExternalId: "100",
          objectHandle: "mistle/backend",
          scopeResourceId: "rsc_sync_resources_relationship_snapshot_team",
          scopeKind: "team",
          scopeExternalId: "100",
          scopeHandle: "mistle/backend",
          metadata: {},
          lastSeenAt: "2026-03-09T00:00:00.000Z",
        },
        {
          id: "irr_sync_resources_relationship_snapshot_carla",
          connectionId: "icn_sync_resources_relationship_snapshot",
          familyId: "github",
          relationshipKind: "belongs_to",
          subjectResourceId: "rsc_sync_resources_relationship_snapshot_carla",
          subjectResourceKind: "user",
          subjectExternalId: "3",
          subjectHandle: "carla",
          objectResourceId: "rsc_sync_resources_relationship_snapshot_team",
          objectResourceKind: "team",
          objectExternalId: "100",
          objectHandle: "mistle/backend",
          scopeResourceId: "rsc_sync_resources_relationship_snapshot_team",
          scopeKind: "team",
          scopeExternalId: "100",
          scopeHandle: "mistle/backend",
          metadata: {},
          lastSeenAt: "2026-03-08T00:00:00.000Z",
          removedAt: "2026-03-08T00:05:00.000Z",
        },
      ]);

    const syncStartedAt = await markResourceSyncing({
      db: env.controlPlaneDb,
      connectionId: "icn_sync_resources_relationship_snapshot",
      familyId: "github",
      kind: "team",
    });
    await expect(
      applySuccessfulResourceSync({
        db: env.controlPlaneDb,
        connectionId: "icn_sync_resources_relationship_snapshot",
        familyId: "github",
        kind: "team",
        syncStartedAt,
        discoveredResources: [
          githubUserResource({
            externalId: "100",
            handle: "mistle/backend",
            displayName: "Backend",
          }),
        ],
        discoveredRelationships: [
          teamMembership({
            subjectExternalId: "1",
            subjectHandle: "alice",
            objectExternalId: "100",
            objectHandle: "mistle/backend",
            scopeExternalId: "100",
            scopeHandle: "mistle/backend",
            metadata: {
              role: "maintainer",
            },
          }),
        ],
      }),
    ).resolves.toBe(true);

    const persistedRelationships =
      await env.controlPlaneDb.query.integrationConnectionResourceRelationships.findMany({
        where: (table, { eq }) =>
          eq(table.connectionId, "icn_sync_resources_relationship_snapshot"),
        orderBy: (table, { asc }) => asc(table.subjectHandle),
      });

    expect(persistedRelationships).toHaveLength(3);
    expect(persistedRelationships[0]).toEqual(
      expect.objectContaining({
        subjectResourceId: "rsc_sync_resources_relationship_snapshot_alice",
        subjectHandle: "alice",
        objectResourceId: "rsc_sync_resources_relationship_snapshot_team",
        scopeResourceId: "rsc_sync_resources_relationship_snapshot_team",
        metadata: {
          role: "maintainer",
        },
        removedAt: null,
      }),
    );
    expect(persistedRelationships[1]).toEqual(
      expect.objectContaining({
        subjectResourceId: "rsc_sync_resources_relationship_snapshot_bob",
        subjectHandle: "bob",
      }),
    );
    expect(persistedRelationships[1]?.removedAt).toBeTruthy();
    expect(persistedRelationships[2]).toEqual(
      expect.objectContaining({
        subjectResourceId: "rsc_sync_resources_relationship_snapshot_carla",
        subjectHandle: "carla",
      }),
    );
    expect(new Date(persistedRelationships[2]?.removedAt ?? "").toISOString()).toBe(
      "2026-03-08T00:05:00.000Z",
    );
  });
});

function githubUserResource(input: {
  externalId: string;
  handle: string;
  displayName: string;
}): DiscoveredIntegrationResource {
  return {
    externalId: input.externalId,
    handle: input.handle,
    displayName: input.displayName,
    metadata: {},
  };
}

function persistedResource(input: {
  id: string;
  connectionId: string;
  kind: string;
  externalId: string;
  handle: string;
  displayName: string;
}): {
  id: string;
  connectionId: string;
  familyId: string;
  kind: string;
  externalId: string;
  handle: string;
  displayName: string;
  status: typeof IntegrationConnectionResourceStatuses.ACCESSIBLE;
  metadata: Record<string, unknown>;
  lastSeenAt: string;
} {
  return {
    id: input.id,
    connectionId: input.connectionId,
    familyId: "github",
    kind: input.kind,
    externalId: input.externalId,
    handle: input.handle,
    displayName: input.displayName,
    status: IntegrationConnectionResourceStatuses.ACCESSIBLE,
    metadata: {},
    lastSeenAt: "2026-03-09T00:00:00.000Z",
  };
}

function teamMembership(input: {
  subjectExternalId: string;
  subjectHandle: string;
  objectExternalId: string;
  objectHandle: string;
  scopeExternalId: string;
  scopeHandle: string;
  metadata: Record<string, unknown>;
}): DiscoveredIntegrationResourceRelationship {
  return {
    relationshipKind: "belongs_to",
    subjectResourceKind: "user",
    subjectExternalId: input.subjectExternalId,
    subjectHandle: input.subjectHandle,
    objectResourceKind: "team",
    objectExternalId: input.objectExternalId,
    objectHandle: input.objectHandle,
    scopeKind: "team",
    scopeExternalId: input.scopeExternalId,
    scopeHandle: input.scopeHandle,
    metadata: input.metadata,
  };
}

function githubUserAttribute(input: {
  resourceExternalId: string;
  resourceHandle: string;
  key: string;
  value: string;
  valueType: DiscoveredIntegrationResourceAttribute["valueType"];
  metadata: Record<string, unknown>;
}): DiscoveredIntegrationResourceAttribute {
  return {
    resourceKind: "user",
    resourceExternalId: input.resourceExternalId,
    resourceHandle: input.resourceHandle,
    key: input.key,
    value: input.value,
    valueType: input.valueType,
    metadata: input.metadata,
  };
}

function persistedAttribute(input: {
  id: string;
  connectionId: string;
  resourceExternalId: string;
  resourceHandle: string;
  attributeKey: string;
  attributeValue: string;
  valueType: DiscoveredIntegrationResourceAttribute["valueType"];
}): {
  id: string;
  connectionId: string;
  familyId: string;
  resourceKind: string;
  resourceExternalId: string;
  resourceHandle: string;
  attributeKey: string;
  attributeValue: string;
  valueType: DiscoveredIntegrationResourceAttribute["valueType"];
  metadata: Record<string, unknown>;
  lastSeenAt: string;
} {
  return {
    id: input.id,
    connectionId: input.connectionId,
    familyId: "github",
    resourceKind: "user",
    resourceExternalId: input.resourceExternalId,
    resourceHandle: input.resourceHandle,
    attributeKey: input.attributeKey,
    attributeValue: input.attributeValue,
    valueType: input.valueType,
    metadata: {},
    lastSeenAt: "2026-03-09T00:00:00.000Z",
  };
}

function createAttributeProviderRegistry(): IntegrationRegistry {
  const registry = new IntegrationRegistry();
  registry.register(createAttributeProviderDefinition());
  return registry;
}

function createAttributeProviderDefinition(): AnyIntegrationDefinition {
  return {
    familyId: "attribute-test",
    variantId: "default",
    kind: IntegrationKinds.CONNECTOR,
    displayName: "Attribute Test",
    logoKey: "github",
    targetConfigSchema: z.object({}).strict(),
    targetSecretSchema: z.object({}).strict(),
    bindingConfigSchema: z.object({}).strict(),
    connectionMethods: [],
    resourceDefinitions: [
      {
        kind: "user",
        selectionMode: "multi",
        bindingField: "users",
        displayNameSingular: "User",
        displayNamePlural: "Users",
        attributeDefinitions: UserAttributeDefinitions,
      },
    ],
    listConnectionResources: () => ({
      resources: [
        githubUserResource({
          externalId: "1",
          handle: "alice",
          displayName: "Alice",
        }),
      ],
      attributes: [
        githubUserAttribute({
          resourceExternalId: "1",
          resourceHandle: "alice",
          key: "is_bot",
          value: "false",
          valueType: "boolean",
          metadata: {
            source: "workflow",
          },
        }),
      ],
    }),
    compileBinding: () => ({
      egressRoutes: [],
      artifacts: [],
      runtimeClients: [],
    }),
  };
}

async function seedAttributeProviderConnection(input: {
  env: IntegrationTestEnvironment;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: "org_sync_resource_attributes_workflow",
    name: "Sync Resource Attributes Workflow",
    slug: "sync-resource-attributes-workflow",
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey: "attribute-test-sync-resource-attributes-workflow",
    familyId: "attribute-test",
    variantId: "default",
    enabled: true,
    config: {},
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: "icn_sync_resource_attributes_workflow",
      organizationId: "org_sync_resource_attributes_workflow",
      targetKey: "attribute-test-sync-resource-attributes-workflow",
      displayName: "Sync Resource Attributes Workflow",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {},
    });
}

async function seedGitHubConnection(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  targetKey: string;
  connectionId: string;
  organizationName: string;
  organizationSlug: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: input.organizationId,
    name: input.organizationName,
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
      displayName: input.organizationName,
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: "123456",
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "123456",
      },
    });
}

async function createSlackConnection(input: {
  env: IntegrationTestEnvironment;
  targetKey: string;
  connectionName: string;
  apiBaseUrl: string;
  email: string;
}): Promise<{
  organizationId: string;
  connectionId: string;
}> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "slack",
    variantId: "slack-default",
    enabled: true,
    config: {
      api_base_url: input.apiBaseUrl,
    },
  });
  const session = await input.env.auth.createSession({
    email: input.email,
  });

  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: input.connectionName,
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
          app_id: SlackAppId,
        },
        secrets: {
          botToken: "xoxb-test-token",
          signingSecret: "slack-signing-secret",
        },
      }),
    },
  );
  expect(response.status).toBe(201);
  const connectionId = readStringField(await response.json(), "id");

  return {
    organizationId: session.organizationId,
    connectionId,
  };
}

function createControlPlaneInternalClient(
  env: IntegrationTestEnvironment,
): ControlPlaneInternalClient {
  return new ControlPlaneInternalClient({
    baseUrl: env.controlPlaneApi.hostBaseUrl,
    internalAuthServiceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

async function startSimulatedSlackApi(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer(handleSimulatedSlackApiRequest);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected Slack API simulator address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

function handleSimulatedSlackApiRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.url === undefined) {
    response.writeHead(500);
    response.end("Missing URL.");
    return;
  }

  const requestUrl = new URL(request.url, "http://127.0.0.1");
  if (requestUrl.pathname !== "/api/conversations.list") {
    response.writeHead(404);
    response.end("Not found.");
    return;
  }

  if (request.headers.authorization !== "Bearer xoxb-test-token") {
    response.writeHead(401, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: "invalid_auth",
      }),
    );
    return;
  }

  response.setHeader("content-type", "application/json");
  // This simulator is intentionally limited to the documented Slack
  // `conversations.list` response fields consumed by the integration
  // definition:
  // https://api.slack.com/methods/conversations.list
  response.end(
    JSON.stringify({
      ok: true,
      channels: [
        {
          id: "C12345678",
          name: "alerts",
          is_channel: true,
          is_private: false,
          is_archived: false,
          is_im: false,
          is_mpim: false,
          is_shared: false,
          is_ext_shared: false,
        },
        {
          id: "C23456789",
          name: "old-alerts",
          is_channel: true,
          is_private: false,
          is_archived: true,
          is_im: false,
          is_mpim: false,
        },
      ],
      response_metadata: {
        next_cursor: "",
      },
    }),
  );
}

function readStringField(input: unknown, fieldName: string): string {
  if (!isRecord(input)) {
    throw new Error("Expected response body to be an object.");
  }
  if (!(fieldName in input)) {
    throw new Error(`Expected response body to include '${fieldName}'.`);
  }

  const value = input[fieldName];
  if (typeof value !== "string") {
    throw new Error(`Expected response body field '${fieldName}' to be a string.`);
  }

  return value;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
