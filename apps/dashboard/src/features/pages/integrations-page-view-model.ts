import {
  formatConnectionMethodLabel,
  resolveConnectionMethodId,
} from "../integrations/connection-auth.js";
import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import type { IntegrationConnectionDetailItem } from "../integrations/integration-connection-detail-view.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethod,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import type {
  IntegrationConnection,
  IntegrationConnectionResource,
} from "../integrations/integrations-service.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import type { OrganizationIntegrationsSettingsPageCard } from "./organization-integrations-settings-page-view.js";

const GitHubAppInstallationCompletePath = "/p/integration/callbacks/github-app-installation";

function resolveTargetConfig(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function toConnectionMethods(
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined,
): readonly IntegrationConnectionMethod[] {
  if (connectionMethods === undefined) {
    return [];
  }

  return connectionMethods;
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
  onOpenCreatePage: (targetKey: string) => void;
}): readonly OrganizationIntegrationsSettingsPageCard[] {
  return input.cards.map((card) => {
    const methods = toConnectionMethods(card.target.connectionMethods);

    return {
      targetKey: card.target.targetKey,
      displayName: card.displayName,
      description: card.description,
      configStatus: card.configStatus,
      ...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey }),
      actionDisabled: methods.length === 0,
      actionLabel: "Add",
      onAction: () => {
        input.onOpenCreatePage(card.target.targetKey);
      },
    };
  });
}

export function buildOpenCreateIntegrationConnectionInput(
  card: IntegrationCardViewModel,
): OpenIntegrationConnectionEditorInput {
  return {
    targetConfig: resolveTargetConfig(card.target.config),
    targetKey: card.target.targetKey,
    targetDisplayName: card.displayName,
    targetFamilyId: card.target.familyId,
    targetVariantId: card.target.variantId,
    methods: toConnectionMethods(card.target.connectionMethods),
    mode: "create",
  };
}

export function resolveEditableConnectionMethodId(
  connection: Pick<IntegrationConnection, "config" | "id" | "targetKey">,
): IntegrationConnectionMethodId {
  const connectionMethodId = resolveConnectionMethodId(connection.config ?? null);
  if (connectionMethodId === null) {
    throw new Error(
      `Unsupported connection method for integration connection '${connection.id}' on target '${connection.targetKey}'.`,
    );
  }

  return connectionMethodId;
}

export function buildIntegrationConnectionDetailItems(input: {
  connections: readonly IntegrationConnection[];
  controlPlaneApiOrigin?: string;
  githubAppInstallationStateByConnectionId?: ReadonlyMap<
    string,
    {
      errorMessage?: string;
      isPending: boolean;
    }
  >;
  refreshingResourceKeys: ReadonlySet<string>;
}): readonly IntegrationConnectionDetailItem[] {
  return input.connections.map((connection) => {
    const connectionMethodId = resolveConnectionMethodId(connection.config ?? null);
    const bindingCount = connection.bindingCount ?? 0;
    const automationCount = connection.automationCount ?? 0;
    const githubAppConnectionContext = resolveGitHubAppConnectionContext(
      connection,
      input.controlPlaneApiOrigin,
    );
    const githubAppInstallationState =
      input.githubAppInstallationStateByConnectionId?.get(connection.id) ?? undefined;

    return {
      id: connection.id,
      displayName: connection.displayName,
      status: connection.status,
      bindingCount,
      canDelete: bindingCount === 0 && automationCount === 0,
      ...(connectionMethodId === null
        ? { authMethodId: null }
        : { authMethodId: connectionMethodId }),
      ...(connectionMethodId === null
        ? {}
        : { authMethodLabel: formatConnectionMethodLabel(connectionMethodId) }),
      ...(githubAppConnectionContext === undefined
        ? {}
        : {
            contextItems: githubAppConnectionContext.contextItems,
            ...(githubAppConnectionContext.installActionLabel === undefined
              ? {}
              : {
                  installActionLabel: githubAppConnectionContext.installActionLabel,
                }),
            ...(githubAppConnectionContext.setupDescription === undefined
              ? {}
              : {
                  ...(githubAppConnectionContext.postInstallationSetupUrl === undefined
                    ? {}
                    : {
                        postInstallationSetupUrl:
                          githubAppConnectionContext.postInstallationSetupUrl,
                      }),
                  setupDescription: githubAppConnectionContext.setupDescription,
                  ...(githubAppInstallationState?.errorMessage === undefined
                    ? {}
                    : { setupErrorMessage: githubAppInstallationState.errorMessage }),
                  ...(githubAppInstallationState === undefined
                    ? {}
                    : { setupIsPending: githubAppInstallationState.isPending }),
                  setupStatusLabel: githubAppConnectionContext.setupStatusLabel,
                }),
            webhookInstructions: githubAppConnectionContext.webhookInstructions,
          }),
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

function resolveGitHubAppConnectionContext(
  connection: Pick<IntegrationConnection, "config" | "externalSubjectId">,
  controlPlaneApiOrigin?: string,
):
  | {
      contextItems: readonly {
        label: string;
        value: string;
      }[];
      installActionLabel?: string;
      postInstallationSetupUrl?: string;
      setupDescription?: string;
      setupStatusLabel?: string;
      webhookInstructions: string;
    }
  | undefined {
  const config = connection.config;
  if (
    config === undefined ||
    typeof config !== "object" ||
    config === null ||
    Array.isArray(config) ||
    config.connection_method !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return undefined;
  }

  const appId = typeof config.app_id === "string" ? config.app_id : null;
  const appSlug = typeof config.app_slug === "string" ? config.app_slug : null;
  const installationId =
    typeof config.installation_id === "string"
      ? config.installation_id
      : typeof connection.externalSubjectId === "string"
        ? connection.externalSubjectId
        : null;

  return {
    contextItems: [
      ...(appId === null
        ? []
        : [
            {
              label: "App ID",
              value: appId,
            },
          ]),
      ...(appSlug === null
        ? []
        : [
            {
              label: "App slug",
              value: appSlug,
            },
          ]),
      {
        label: "Installation",
        value: installationId === null ? "Pending" : installationId,
      },
    ],
    ...(installationId === null
      ? { installActionLabel: "Install GitHub App" }
      : { installActionLabel: "Manage installation" }),
    ...(installationId === null
      ? {
          setupDescription:
            "Set the webhook callback URL and post-installation setup URL in your GitHub App settings, then install the app to finish setup.",
          ...(controlPlaneApiOrigin === undefined
            ? {}
            : {
                postInstallationSetupUrl: new URL(
                  GitHubAppInstallationCompletePath,
                  controlPlaneApiOrigin,
                ).toString(),
              }),
          setupStatusLabel: "Setup incomplete",
        }
      : {}),
    webhookInstructions:
      "Copy the callback URL into your GitHub App webhook settings, then install the app to finish setup.",
  };
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
