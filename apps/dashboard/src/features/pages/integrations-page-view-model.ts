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
import type { IntegrationConnection } from "../integrations/integrations-service.js";
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
      ...(authScheme === null
        ? {}
        : { authMethodLabel: formatConnectionAuthMethodLabel(authScheme) }),
      ...(connection.externalSubjectId === undefined
        ? {}
        : { externalSubjectId: connection.externalSubjectId }),
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      resources: (connection.resources ?? []).map((resource) => ({
        kind: resource.kind,
        selectionMode: resource.selectionMode,
        count: resource.count,
        syncState: resource.syncState,
        ...(resource.lastSyncedAt === undefined ? {} : { lastSyncedAt: resource.lastSyncedAt }),
        ...(resource.lastErrorMessage === undefined
          ? {}
          : { lastErrorMessage: resource.lastErrorMessage }),
        isRefreshing:
          resource.syncState === "syncing" ||
          input.refreshingResourceKeys.has(
            createRefreshingResourceKey({
              connectionId: connection.id,
              kind: resource.kind,
            }),
          ),
      })),
    };
  });
}

export function createRefreshingResourceKey(input: { connectionId: string; kind: string }): string {
  return `${input.connectionId}:${input.kind}`;
}
