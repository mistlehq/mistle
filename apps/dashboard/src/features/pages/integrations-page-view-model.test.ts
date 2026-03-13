import { describe, expect, it } from "vitest";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import { IntegrationConnectionMethodIds } from "../integrations/integration-connection-dialog.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  buildAvailableIntegrationViewCards,
  buildConnectedIntegrationViewCards,
  buildIntegrationConnectionDetailItems,
  buildIntegrationConnectionResourceItemsByKey,
  buildIntegrationConnectionResourceRequests,
  createIntegrationConnectionResourceKey,
  createRefreshingResourceKey,
  getIntegrationConnectionResourceSummaries,
  resolveEditableConnectionMethodId,
  shouldPollIntegrationDetailResources,
  toConnectionMethods,
} from "./integrations-page-view-model.js";

describe("integrations page view model", () => {
  it("maps supported auth schemes to dialog method ids", () => {
    expect(toConnectionMethods(["oauth", "api-key"])).toEqual([
      IntegrationConnectionMethodIds.OAUTH,
      IntegrationConnectionMethodIds.API_KEY,
    ]);
    expect(toConnectionMethods(undefined)).toEqual([]);
  });

  it("builds connected integration cards with view actions", () => {
    let openedTargetKey: string | null = null;

    const [card] = buildConnectedIntegrationViewCards({
      connectedCards: [createCard({ description: "GitHub", connectionCount: 2 })],
      onOpenTarget: (targetKey) => {
        openedTargetKey = targetKey;
      },
    });

    expect(card?.actionLabel).toBe("View");
    expect(card?.description).toBe("2 connections");
    card?.onAction();
    expect(openedTargetKey).toBe("github");
  });

  it("builds connected integration cards for targets with non-active connections", () => {
    const [card] = buildConnectedIntegrationViewCards({
      connectedCards: [
        createCard({
          description: "GitHub",
          connectionStatuses: ["error"],
        }),
      ],
      onOpenTarget: () => {},
    });

    expect(card?.description).toBe("1 connection");
    expect(card?.actionLabel).toBe("View");
  });

  it("builds available integration cards with add actions and disabled invalid entries", () => {
    let receivedTargetKey: string | null = null;

    const [card] = buildAvailableIntegrationViewCards({
      cards: [createCard({ description: "Bring GitHub into Mistle.", supportedAuthSchemes: [] })],
      onOpenCreateDialog: (input) => {
        receivedTargetKey = input.targetKey;
      },
    });

    expect(card?.actionLabel).toBe("Add");
    expect(card?.actionDisabled).toBe(true);
    card?.onAction();
    expect(receivedTargetKey).toBe("github");
  });

  it("builds detail items with auth labels and refreshing resource state", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_123",
          targetKey: "github",
          displayName: "Engineering GitHub",
          status: "active",
          config: { auth_scheme: "oauth" },
          externalSubjectId: "mistle-labs",
          resources: [
            {
              kind: "repositories",
              selectionMode: "multi",
              count: 42,
              syncState: "ready",
              lastSyncedAt: "2026-03-11T04:25:00.000Z",
              lastErrorMessage: "Resource sync failed.",
            },
          ],
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      refreshingResourceKeys: new Set([
        createRefreshingResourceKey({
          connectionId: "icn_123",
          kind: "repositories",
        }),
      ]),
    });

    expect(item?.authMethodLabel).toBe("OAuth");
    expect(item?.authMethodId).toBe("oauth");
    expect(item?.resources[0]?.isRefreshing).toBe(true);
    expect(item?.resources[0]?.lastErrorMessage).toBe("Resource sync failed.");
  });

  it("marks syncing resources as refreshing even without a local pending refresh", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_123",
          targetKey: "github",
          displayName: "Engineering GitHub",
          status: "active",
          resources: [
            {
              kind: "repositories",
              selectionMode: "multi",
              count: 42,
              syncState: "syncing",
            },
          ],
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.resources[0]?.isRefreshing).toBe(true);
  });

  it("returns an empty resource summary list when a connection has no resources payload", () => {
    expect(
      getIntegrationConnectionResourceSummaries({
        resources: undefined,
      }),
    ).toEqual([]);

    expect(getIntegrationConnectionResourceSummaries(null)).toEqual([]);
  });

  it("builds resource requests and keyed resource-item lookups for detail connections", () => {
    const requests = buildIntegrationConnectionResourceRequests([
      createConnection({
        id: "icn_primary",
        status: "active",
        resources: [
          {
            kind: "repositories",
            selectionMode: "multi",
            count: 42,
            syncState: "ready",
          },
        ],
      }),
      createConnection({
        id: "icn_secondary",
        status: "active",
        resources: [
          {
            kind: "organizations",
            selectionMode: "single",
            count: 1,
            syncState: "never-synced",
          },
        ],
      }),
    ]);

    expect(requests).toEqual([
      {
        connectionId: "icn_primary",
        kind: "repositories",
        syncState: "ready",
      },
      {
        connectionId: "icn_secondary",
        kind: "organizations",
        syncState: "never-synced",
      },
    ]);

    const itemsByKey = buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId: "icn_primary",
        state: {
          errorMessage: null,
          isLoading: false,
          items: [],
          kind: "repositories",
        },
      },
    ]);

    expect(
      itemsByKey.get(
        createIntegrationConnectionResourceKey({
          connectionId: "icn_primary",
          kind: "repositories",
        }),
      ),
    ).toEqual({
      errorMessage: null,
      isLoading: false,
      items: [],
      kind: "repositories",
    });
  });

  it("polls while the selected detail connection has syncing resources", () => {
    expect(
      shouldPollIntegrationDetailResources({
        cards: [
          createCard({
            description: "GitHub",
            connections: [
              createConnection({
                id: "icn_syncing",
                status: "active",
                resources: [
                  {
                    kind: "repositories",
                    selectionMode: "multi",
                    count: 42,
                    syncState: "syncing",
                  },
                ],
              }),
            ],
          }),
        ],
        activeDetailConnectionId: "icn_syncing",
        detailTargetKey: "github",
      }),
    ).toBe(true);
  });

  it("stops polling when not on a detail route or no selected resource is syncing", () => {
    expect(
      shouldPollIntegrationDetailResources({
        cards: [createCard({ description: "GitHub" })],
        activeDetailConnectionId: null,
        detailTargetKey: null,
      }),
    ).toBe(false);

    expect(
      shouldPollIntegrationDetailResources({
        cards: [
          createCard({
            description: "GitHub",
            connections: [
              createConnection({
                id: "icn_ready",
                status: "active",
                resources: [
                  {
                    kind: "repositories",
                    selectionMode: "multi",
                    count: 42,
                    syncState: "ready",
                  },
                ],
              }),
            ],
          }),
        ],
        activeDetailConnectionId: "icn_ready",
        detailTargetKey: "github",
      }),
    ).toBe(false);
  });

  it("fails fast when editing a connection with an unsupported auth scheme", () => {
    expect(() =>
      resolveEditableConnectionMethodId({
        id: "icn_123",
        targetKey: "github",
        config: {
          auth_scheme: "bearer-token",
        },
      }),
    ).toThrow("Unsupported auth scheme for integration connection 'icn_123' on target 'github'.");
  });
});

function createCard(input: {
  description: string;
  connectionCount?: number;
  connections?: readonly IntegrationConnection[];
  connectionStatuses?: readonly IntegrationConnection["status"][];
  supportedAuthSchemes?: ("oauth" | "api-key")[];
}): IntegrationCardViewModel {
  if (input.connections !== undefined) {
    return {
      target: {
        targetKey: "github",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {},
        displayName: "GitHub",
        description: input.description,
        ...(input.supportedAuthSchemes === undefined
          ? {}
          : { supportedAuthSchemes: [...input.supportedAuthSchemes] }),
        targetHealth: {
          configStatus: "valid",
        },
      },
      displayName: "GitHub",
      description: input.description,
      status: "Connected",
      configStatus: "valid",
      connections: [...input.connections],
    };
  }

  const connectionStatuses =
    input.connectionStatuses ??
    Array.from<IntegrationConnection["status"]>({ length: input.connectionCount ?? 1 }).fill(
      "active",
    );
  const connections: IntegrationConnection[] = connectionStatuses.map((status, index) => ({
    id: `icn_${index}`,
    targetKey: "github",
    displayName: `GitHub ${index}`,
    status,
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
  }));

  return {
    target: {
      targetKey: "github",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {},
      displayName: "GitHub",
      description: input.description,
      ...(input.supportedAuthSchemes === undefined
        ? {}
        : { supportedAuthSchemes: [...input.supportedAuthSchemes] }),
      targetHealth: {
        configStatus: "valid",
      },
    },
    displayName: "GitHub",
    description: input.description,
    status: "Connected",
    configStatus: "valid",
    connections,
  };
}

function createConnection(
  input: Partial<IntegrationConnection> & Pick<IntegrationConnection, "id" | "status">,
): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "github",
    displayName: input.displayName ?? `GitHub ${input.id}`,
    status: input.status,
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
    ...(input.resources === undefined ? {} : { resources: input.resources }),
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.externalSubjectId === undefined
      ? {}
      : { externalSubjectId: input.externalSubjectId }),
  };
}
