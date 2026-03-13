import { describe, expect, it } from "vitest";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import { IntegrationConnectionMethodIds } from "../integrations/integration-connection-dialog.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  buildAvailableIntegrationViewCards,
  buildConnectedIntegrationViewCards,
  buildIntegrationConnectionDetailItems,
  createRefreshingResourceKey,
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
    expect(item?.externalSubjectId).toBe("mistle-labs");
    expect(item?.resources[0]?.isRefreshing).toBe(true);
  });
});

function createCard(input: {
  description: string;
  connectionCount?: number;
  connectionStatuses?: readonly IntegrationConnection["status"][];
  supportedAuthSchemes?: ("oauth" | "api-key")[];
}): IntegrationCardViewModel {
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
