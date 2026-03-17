import {
  createControlPlaneDatabase,
  integrationConnectionResources,
  integrationConnectionResourceStates,
  IntegrationConnectionResourceStatuses,
  IntegrationConnectionResourceSyncStates,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizations,
  CONTROL_PLANE_SCHEMA_NAME,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { syncIntegrationConnectionResources } from "../openworkflow/sync-integration-connection-resources/sync-integration-connection-resources.js";
import { it } from "./test-context.js";

async function createTestDatabase(input: { databaseUrl: string }) {
  await runControlPlaneMigrations({
    connectionString: input.databaseUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  const pool = new Pool({
    connectionString: input.databaseUrl,
  });
  const db = createControlPlaneDatabase(pool);

  return {
    db,
    stop: async () => {
      await pool.end();
    },
  };
}

describe("syncIntegrationConnectionResources integration", () => {
  it("marks sync state as error and preserves the last snapshot when credential resolution is unavailable", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const organizationId = "org_sync_resources_missing_listing";
      const targetKey = "github-cloud-sync-resources-missing-listing";
      const connectionId = "icn_sync_resources_missing_listing";

      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Sync Resources Missing Listing",
        slug: "sync-resources-missing-listing",
      });
      await database.db.insert(integrationTargets).values({
        targetKey,
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      });
      await database.db.insert(integrationConnections).values({
        id: connectionId,
        organizationId,
        targetKey,
        displayName: "GitHub Sync Resources Missing Listing",
        status: IntegrationConnectionStatuses.ACTIVE,
        externalSubjectId: "123456",
        config: {
          connection_method: "github-app-installation",
          installation_id: "123456",
        },
      });
      await database.db.insert(integrationConnectionResourceStates).values({
        connectionId,
        familyId: "github",
        kind: "repository",
        syncState: IntegrationConnectionResourceSyncStates.READY,
        totalCount: 1,
        lastSyncedAt: "2026-03-09T00:00:00.000Z",
        lastSyncStartedAt: "2026-03-09T00:01:00.000Z",
        lastSyncFinishedAt: "2026-03-09T00:01:30.000Z",
      });
      await database.db.insert(integrationConnectionResources).values({
        id: "rsc_sync_resources_missing_listing",
        connectionId,
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
            db: database.db,
            integrationRegistry: createIntegrationRegistry(),
          },
          {
            organizationId,
            connectionId,
            kind: "repository",
          },
        ),
      ).rejects.toThrow("Resource sync credential resolution is not configured.");

      const persistedState = await database.db.query.integrationConnectionResourceStates.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, connectionId), eq(table.kind, "repository")),
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

      const persistedResources = await database.db.query.integrationConnectionResources.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, connectionId), eq(table.kind, "repository")),
      });
      expect(persistedResources).toHaveLength(1);

      const persistedResource = persistedResources[0];
      if (persistedResource === undefined) {
        throw new Error("Expected persisted resource snapshot.");
      }

      expect(persistedResource.status).toBe(IntegrationConnectionResourceStatuses.ACCESSIBLE);
      expect(persistedResource.handle).toBe("mistlehq/demo");
      expect(persistedResource.removedAt).toBeNull();
      expect(persistedResource.metadata).toEqual({
        defaultBranch: "main",
      });
    } finally {
      await database.stop();
    }
  });
});
