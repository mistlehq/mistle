import {
  formatConnectionAuthMethodLabel,
  resolveConnectionAuthScheme,
} from "../integrations/connection-auth.js";
import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import type { IntegrationConnectionDetailItem } from "../integrations/integration-connection-detail-view.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import type {
  IntegrationConnection,
  IntegrationConnectionResource,
} from "../integrations/integrations-service.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";
import type { OrganizationIntegrationsSettingsPageCard } from "./organization-integrations-settings-page-view.js";

export function toConnectionMethods(
  supportedAuthSchemes: readonly ("oauth" | "api-key")[] | undefined,
): readonly IntegrationConnectionMethodId[] {
  if (supportedAuthSchemes === undefined) {
    return [];
  }

  return supportedAuthSchemes.map((scheme) =>
    scheme === "api-key"
      ? IntegrationConnectionMethodIds.API_KEY
      : IntegrationConnectionMethodIds.OAUTH,
  );
}

export function buildConnectedIntegrationViewCards(input: {
  connectedCards: readonly IntegrationCardViewModel[];
  onOpenTarget: (targetKey: string) => void;
}): readonly OrganizationIntegrationsSettingsPageCard[] {
  return input.connectedCards.map((card) => ({
    targetKey: card.target.targetKey,
    displayName: card.displayName,
    description: formatConnectionCount(card.connections.length),
    configStatus: card.configStatus,
    ...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey }),
    actionLabel: "View",
    onAction: () => {
      input.onOpenTarget(card.target.targetKey);
    },
  }));
}

export function buildAvailableIntegrationViewCards(input: {
  cards: readonly IntegrationCardViewModel[];
  onOpenCreateDialog: (input: OpenIntegrationConnectionDialogInput) => void;
}): readonly OrganizationIntegrationsSettingsPageCard[] {
  return input.cards.map((card) => {
    const methods = toConnectionMethods(card.target.supportedAuthSchemes);

    return {
      targetKey: card.target.targetKey,
      displayName: card.displayName,
      description: card.description,
      configStatus: card.configStatus,
      ...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey }),
      actionDisabled: methods.length === 0,
      actionLabel: "Add",
      onAction: () => {
        input.onOpenCreateDialog({
          targetKey: card.target.targetKey,
          targetDisplayName: card.displayName,
          methods,
          mode: "create",
        });
      },
    };
  });
}

export function resolveEditableConnectionMethodId(
  connection: Pick<IntegrationConnection, "config" | "id" | "targetKey">,
): IntegrationConnectionMethodId {
  const authScheme = resolveConnectionAuthScheme(connection.config ?? null);
  if (authScheme === null) {
    throw new Error(
      `Unsupported auth scheme for integration connection '${connection.id}' on target '${connection.targetKey}'.`,
    );
  }

  return authScheme;
}

export function buildIntegrationConnectionDetailItems(input: {
  connections: readonly IntegrationConnection[];
  refreshingResourceKeys: ReadonlySet<string>;
}): readonly IntegrationConnectionDetailItem[] {
  return input.connections.map((connection) => {
    const authScheme = resolveConnectionAuthScheme(connection.config ?? null);

    return {
      id: connection.id,
      displayName: connection.displayName,
      status: connection.status,
      ...(authScheme === null ? { authMethodId: null } : { authMethodId: authScheme }),
      ...(authScheme === null
        ? {}
        : { authMethodLabel: formatConnectionAuthMethodLabel(authScheme) }),
      resources: (connection.resources ?? []).map((resource) => ({
        kind: resource.kind,
        count: resource.count,
        syncState: resource.syncState,
        ...(resource.lastSyncedAt === undefined ? {} : { lastSyncedAt: resource.lastSyncedAt }),
        ...(resource.lastErrorMessage === undefined
          ? {}
          : { lastErrorMessage: resource.lastErrorMessage }),
        isRefreshing:
          resource.syncState === "syncing" ||
          input.refreshingResourceKeys.has(
            createIntegrationConnectionResourceKey({
              connectionId: connection.id,
              kind: resource.kind,
            }),
          ),
      })),
    };
  });
}

export function createIntegrationConnectionResourceKey(input: {
  connectionId: string;
  kind: string;
}): string {
  return `${input.connectionId}:${input.kind}`;
}

export function createRefreshingResourceKey(input: { connectionId: string; kind: string }): string {
  return createIntegrationConnectionResourceKey(input);
}

export function getIntegrationConnectionResourceSummaries(
  connection: Pick<IntegrationConnection, "resources"> | null,
): readonly NonNullable<IntegrationConnection["resources"]>[number][] {
  return connection?.resources ?? [];
}

export function buildIntegrationConnectionResourceRequests(
  connections: readonly Pick<IntegrationConnection, "id" | "resources">[],
): readonly {
  connectionId: string;
  kind: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
}[] {
  return connections.flatMap((connection) =>
    (connection.resources ?? []).map((resource) => ({
      connectionId: connection.id,
      kind: resource.kind,
      syncState: resource.syncState,
    })),
  );
}

export type IntegrationConnectionResourceItemsState = {
  errorMessage: string | null;
  isLoading: boolean;
  items: readonly IntegrationConnectionResource[];
  kind: string;
};

export function buildIntegrationConnectionResourceItemsByKey(
  input: readonly {
    connectionId: string;
    state: IntegrationConnectionResourceItemsState;
  }[],
): ReadonlyMap<string, IntegrationConnectionResourceItemsState> {
  return new Map(
    input.map((entry) => [
      createIntegrationConnectionResourceKey({
        connectionId: entry.connectionId,
        kind: entry.state.kind,
      }),
      entry.state,
    ]),
  );
}

export function shouldPollIntegrationDetailResources(input: {
  cards: readonly IntegrationCardViewModel[];
  activeDetailConnectionId: string | null;
  detailTargetKey: string | null;
}): boolean {
  if (input.detailTargetKey === null) {
    return false;
  }

  const selectedDetailCard =
    input.cards.find((card) => card.target.targetKey === input.detailTargetKey) ?? null;
  if (selectedDetailCard === null) {
    return false;
  }

  const selectedConnection =
    selectedDetailCard.connections.find(
      (connection) => connection.id === input.activeDetailConnectionId,
    ) ??
    selectedDetailCard.connections.find((connection) => connection.status === "active") ??
    selectedDetailCard.connections[0] ??
    null;
  if (selectedConnection === null) {
    return false;
  }

  return (
    selectedConnection.resources?.some((resource) => resource.syncState === "syncing") ?? false
  );
}
