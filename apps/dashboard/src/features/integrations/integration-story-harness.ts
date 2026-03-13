import {
  buildIntegrationConnectionDetailItems,
  buildIntegrationConnectionResourceItemsByKey,
  createRefreshingResourceKey,
} from "../pages/integrations-page-view-model.js";
import type { IntegrationConnection } from "./integrations-service.js";

export const DemoIntegrationConnections: readonly IntegrationConnection[] = [
  {
    id: "icn_github_primary",
    targetKey: "github",
    displayName: "Engineering GitHub",
    status: "active",
    config: { auth_scheme: "oauth" },
    externalSubjectId: "mistle-labs",
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
    resources: [
      {
        kind: "repositories",
        selectionMode: "multi",
        count: 41,
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      },
      {
        kind: "organizations",
        selectionMode: "single",
        count: 1,
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      },
    ],
  },
  {
    id: "icn_github_archive",
    targetKey: "github",
    displayName: "Archive Mirror",
    status: "error",
    config: { auth_scheme: "api-key" },
    createdAt: "2026-02-14T00:00:00.000Z",
    updatedAt: "2026-03-10T10:15:00.000Z",
    resources: [
      {
        kind: "repositories",
        selectionMode: "multi",
        count: 0,
        syncState: "error",
        lastErrorMessage: "GitHub returned a 403 while reading repository visibility.",
      },
      {
        kind: "organizations",
        selectionMode: "single",
        count: 0,
        syncState: "never-synced",
      },
    ],
  },
] as const;

export function getPrimaryDemoIntegrationConnection(): IntegrationConnection {
  const connection =
    DemoIntegrationConnections.find((item) => item.id === "icn_github_primary") ?? null;
  if (connection === null) {
    throw new Error("Expected a primary integration story connection.");
  }

  return connection;
}

export function createDetailViewStoryProps(input?: {
  connections?: readonly IntegrationConnection[];
  refreshingResourceKeys?: ReadonlySet<string>;
}) {
  const connections = input?.connections ?? DemoIntegrationConnections;
  const refreshingResourceKeys = input?.refreshingResourceKeys ?? new Set<string>();

  return {
    connections: buildIntegrationConnectionDetailItems({
      connections,
      refreshingResourceKeys,
    }),
    resourceItemsByKey: buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId: "icn_github_primary",
        state: {
          errorMessage: null,
          isLoading: false,
          items: [
            {
              id: "repo_1",
              familyId: "github",
              kind: "repositories",
              handle: "mistle/dashboard",
              displayName: "mistle/dashboard",
              status: "accessible",
              metadata: {},
            },
            {
              id: "repo_2",
              familyId: "github",
              kind: "repositories",
              handle: "mistle/control-plane-api",
              displayName: "mistle/control-plane-api",
              status: "accessible",
              metadata: {},
            },
          ],
          kind: "repositories",
        },
      },
      {
        connectionId: "icn_github_archive",
        state: {
          errorMessage: null,
          isLoading: false,
          items: [],
          kind: "repositories",
        },
      },
    ]),
  };
}

export function createRefreshingDetailViewStoryProps() {
  const primaryConnection = getPrimaryDemoIntegrationConnection();

  return createDetailViewStoryProps({
    connections: [primaryConnection],
    refreshingResourceKeys: new Set<string>([
      createRefreshingResourceKey({
        connectionId: primaryConnection.id,
        kind: "repositories",
      }),
    ]),
  });
}
