import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
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
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
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

async function startHttpServer(input: {
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer(input.handler);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected HTTP server address.");
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
          app_id: "123",
          app_slug: "mistle-github-app",
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

  it("syncs Slack public channel resources through the worker workflow", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    const slackApiServer = await startHttpServer({
      handler(request, response) {
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

        response.setHeader("content-type", "application/json");
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
      },
    });

    const internalApiServer = await startHttpServer({
      handler(request, response) {
        if (request.url !== "/internal/integration-credentials/resolve") {
          response.writeHead(404);
          response.end("Not found.");
          return;
        }

        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            kind: "value",
            value: "xoxb-test-token",
          }),
        );
      },
    });

    try {
      const organizationId = "org_sync_resources_slack_channel";
      const targetKey = "slack-default-sync-resources-channel";
      const connectionId = "icn_sync_resources_slack_channel";

      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Sync Resources Slack Channel",
        slug: "sync-resources-slack-channel",
      });
      await database.db.insert(integrationTargets).values({
        targetKey,
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: `${slackApiServer.baseUrl}/api`,
        },
      });
      await database.db.insert(integrationConnections).values({
        id: connectionId,
        organizationId,
        targetKey,
        displayName: "Slack Sync Resources Channel",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "slack-bot-token",
        },
      });

      await expect(
        syncIntegrationConnectionResources(
          {
            db: database.db,
            integrationRegistry: createIntegrationRegistry(),
            controlPlaneInternalClient: new ControlPlaneInternalClient({
              baseUrl: internalApiServer.baseUrl,
              internalAuthServiceToken: fixture.internalAuthServiceToken,
            }),
          },
          {
            organizationId,
            connectionId,
            kind: "channel",
          },
        ),
      ).resolves.toEqual({
        organizationId,
        connectionId,
        kind: "channel",
      });

      const persistedState = await database.db.query.integrationConnectionResourceStates.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, connectionId), eq(table.kind, "channel")),
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

      const persistedResources = await database.db.query.integrationConnectionResources.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.connectionId, connectionId), eq(table.kind, "channel")),
      });
      expect(persistedResources).toHaveLength(1);

      const persistedResource = persistedResources[0];
      if (persistedResource === undefined) {
        throw new Error("Expected persisted Slack channel resource.");
      }

      expect(persistedResource.externalId).toBe("C12345678");
      expect(persistedResource.handle).toBe("C12345678");
      expect(persistedResource.displayName).toBe("#alerts");
      expect(persistedResource.status).toBe(IntegrationConnectionResourceStatuses.ACCESSIBLE);
      expect(persistedResource.removedAt).toBeNull();
      expect(persistedResource.metadata).toEqual({
        name: "alerts",
        isPrivate: false,
        isArchived: false,
        isShared: false,
        isExtShared: false,
        isIm: false,
        isMpim: false,
        isChannel: true,
      });
    } finally {
      await internalApiServer.stop();
      await slackApiServer.stop();
      await database.stop();
    }
  });
});
