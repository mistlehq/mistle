import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import type { IntegrationConnectionDetailItem } from "../integrations/integration-connection-detail-view.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethod,
} from "../integrations/integration-connection-editor.js";
import type {
  IntegrationConnection,
  IntegrationConnectionResource,
} from "../integrations/integrations-service.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import type { OrganizationIntegrationsSettingsPageCard } from "./organization-integrations-settings-page-view.js";
import { resolveVisibleConnectionMethodConfigFields } from "./use-integration-connection-editor-state-helpers.js";

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

export function buildOpenUpdateIntegrationConnectionInput(input: {
  card: IntegrationCardViewModel;
  connection: IntegrationConnection;
}): OpenIntegrationConnectionEditorInput {
  const connectionMethodId = input.connection.connectionMethodId;
  if (connectionMethodId === undefined) {
    throw new Error(
      `Connection '${input.connection.id}' is missing connectionMethodId for update editor input.`,
    );
  }

  const currentMethod =
    toConnectionMethods(input.card.target.connectionMethods).find(
      (method) => method.id === connectionMethodId,
    ) ?? null;
  if (currentMethod === null) {
    throw new Error(
      `Connection '${input.connection.id}' references unknown method '${connectionMethodId}'.`,
    );
  }

  return {
    mode: "update",
    connectionConfig: resolveTargetConfig(input.connection.config),
    connectionDisplayName: input.connection.displayName,
    connectionId: input.connection.id,
    ...(input.connection.configuredSecretNames === undefined
      ? {}
      : { configuredSecretNames: input.connection.configuredSecretNames }),
    currentMethod,
    targetConfig: resolveTargetConfig(input.card.target.config),
    targetDisplayName: input.card.displayName,
    targetFamilyId: input.card.target.familyId,
    targetKey: input.card.target.targetKey,
    targetVariantId: input.card.target.variantId,
  };
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
  refreshingConnectionIds?: ReadonlySet<string>;
  refreshingResourceKeys: ReadonlySet<string>;
  targetConfig?: Record<string, unknown>;
  targetConnectionMethods?: readonly IntegrationConnectionMethod[];
  targetFamilyId?: string;
  targetVariantId?: string;
}): readonly IntegrationConnectionDetailItem[] {
  return input.connections.map((connection) => {
    const bindingCount = connection.bindingCount ?? 0;
    const automationCount = connection.automationCount ?? 0;
    const githubAppConnectionContext = resolveGitHubAppConnectionContext(
      connection,
      input.controlPlaneApiOrigin,
    );
    const githubAppInstallationState =
      input.githubAppInstallationStateByConnectionId?.get(connection.id) ?? undefined;
    const currentMethod =
      connection.connectionMethodId === undefined
        ? null
        : (input.targetConnectionMethods?.find(
            (method) => method.id === connection.connectionMethodId,
          ) ?? null);
    const authFields = resolveAuthFields({
      connection,
      currentMethod,
      ...(input.targetConfig === undefined ? {} : { targetConfig: input.targetConfig }),
      ...(input.targetFamilyId === undefined ? {} : { targetFamilyId: input.targetFamilyId }),
      ...(input.targetVariantId === undefined ? {} : { targetVariantId: input.targetVariantId }),
    });
    const authSecretLabels =
      currentMethod?.kind === "form"
        ? currentMethod.secretFields
            .filter((field) => field.optional !== true)
            .map((field) => field.label)
        : [];
    const isIdentityLinked = connection.isIdentityLinked === true;

    return {
      id: connection.id,
      displayName: connection.displayName,
      status: connection.status,
      ...(isIdentityLinked ? { isIdentityLinked: true } : {}),
      bindingCount,
      canDelete: bindingCount === 0 && automationCount === 0 && !isIdentityLinked,
      ...(connection.connectionMethodId === undefined
        ? { authMethodId: null }
        : { authMethodId: connection.connectionMethodId }),
      ...(connection.connectionMethodLabel === undefined
        ? {}
        : { authMethodLabel: connection.connectionMethodLabel }),
      ...(authFields.length === 0 ? {} : { authFields }),
      ...(authSecretLabels.length === 0 ? {} : { authSecretLabels }),
      ...(githubAppConnectionContext === undefined
        ? {}
        : {
            ...(githubAppConnectionContext.installation === undefined
              ? {}
              : {
                  installation: {
                    ...githubAppConnectionContext.installation,
                    ...(githubAppInstallationState?.errorMessage === undefined
                      ? {}
                      : { errorMessage: githubAppInstallationState.errorMessage }),
                    ...(githubAppInstallationState === undefined
                      ? {}
                      : { isPending: githubAppInstallationState.isPending }),
                  },
                }),
            ...(githubAppConnectionContext.contextItems === undefined
              ? {}
              : { contextItems: githubAppConnectionContext.contextItems }),
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
          input.refreshingConnectionIds?.has(connection.id) === true ||
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

export type IntegrationConnectionDetailWebhookPolicy = {
  canCreateWebhookSource: boolean;
  canDeleteWebhookSource: boolean;
  showWebhookSources: boolean;
};

export function resolveIntegrationConnectionDetailWebhookPolicy(input: {
  webhookSource:
    | {
        lifecycle?: string;
      }
    | undefined;
}): IntegrationConnectionDetailWebhookPolicy {
  const lifecycle = input.webhookSource?.lifecycle;
  const supportsManagedWebhookActions = lifecycle === "managed";

  return {
    canCreateWebhookSource: supportsManagedWebhookActions,
    canDeleteWebhookSource: supportsManagedWebhookActions,
    showWebhookSources: input.webhookSource !== undefined,
  };
}

function resolveAuthFields(input: {
  connection: IntegrationConnection;
  currentMethod: IntegrationConnectionMethod | null;
  targetConfig?: Record<string, unknown>;
  targetFamilyId?: string;
  targetVariantId?: string;
}): readonly {
  label: string;
  value: string;
}[] {
  const methodLabel = input.connection.connectionMethodLabel;
  const fields: {
    label: string;
    value: string;
  }[] = [];

  if (methodLabel !== undefined) {
    fields.push({
      label: "Method",
      value: methodLabel,
    });
  }

  if (
    input.currentMethod === null ||
    input.connection.config === undefined ||
    input.targetConfig === undefined ||
    input.targetFamilyId === undefined ||
    input.targetVariantId === undefined
  ) {
    return fields;
  }

  const visibleConfigFields = resolveVisibleConnectionMethodConfigFields({
    connectionId: input.connection.id,
    connectionMethod: input.currentMethod,
    connectionConfig: resolveTargetConfig(input.connection.config),
    targetConfig: input.targetConfig,
    targetFamilyId: input.targetFamilyId,
    targetKey: input.connection.targetKey,
    targetVariantId: input.targetVariantId,
  });

  return [...fields, ...visibleConfigFields];
}

function resolveGitHubAppConnectionContext(
  connection: Pick<IntegrationConnection, "config" | "externalSubjectId">,
  controlPlaneApiOrigin?: string,
):
  | {
      contextItems?: readonly {
        label: string;
        value: string;
      }[];
      installation?:
        | {
            actionLabel: string;
            description?: string;
            fields: readonly {
              label: string;
              value: string;
            }[];
            postInstallationSetupUrl?: string;
          }
        | undefined;
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

  if (installationId === null) {
    return undefined;
  }

  const installationFields = [
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
      value: installationId,
    },
  ];

  return {
    installation: {
      actionLabel: "Manage installation",
      fields: installationFields,
      ...(controlPlaneApiOrigin === undefined
        ? {}
        : {
            postInstallationSetupUrl: new URL(
              GitHubAppInstallationCompletePath,
              controlPlaneApiOrigin,
            ).toString(),
          }),
    },
  };
}

export function createIntegrationConnectionResourceKey(input: {
  connectionId: string;
  kind: string;
}): string {
  return `${input.connectionId}:${input.kind}`;
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

export function buildIntegrationConnectionResourceItemsByKey(
  input: readonly {
    connectionId: string;
    state: {
      isLoading: boolean;
      items: readonly IntegrationConnectionResource[];
      kind: string;
      errorMessage: string | null;
    };
  }[],
): ReadonlyMap<
  string,
  {
    isLoading: boolean;
    items: readonly IntegrationConnectionResource[];
    kind: string;
    errorMessage: string | null;
  }
> {
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

export function shouldAutoRefreshIntegrationConnectionResources(input: {
  connection: Pick<IntegrationConnection, "id" | "resources"> | null | undefined;
  routeConnectionId: string | null;
}): boolean {
  if (
    input.routeConnectionId === null ||
    input.connection === null ||
    input.connection === undefined ||
    input.connection.id !== input.routeConnectionId
  ) {
    return false;
  }

  const resources = input.connection.resources ?? [];
  return (
    resources.length > 0 && resources.every((resource) => resource.syncState === "never-synced")
  );
}
