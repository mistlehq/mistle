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
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
  TestEnvironmentIdHeader,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { applySuccessfulResourceSync } from "../openworkflow/sync-integration-connection-resources/apply-successful-resource-sync.js";
import { markResourceSyncing } from "../openworkflow/sync-integration-connection-resources/mark-resource-syncing.js";
import { syncIntegrationConnectionResources } from "../openworkflow/sync-integration-connection-resources/sync-integration-connection-resources.js";

const InternalServiceToken = "integration-new-internal-service-token";

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
});

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
