import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { Notice, NoticeAutoHideDurationsMs } from "@mistle/ui";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteIntegrationConnectionDialog } from "../integrations/delete-integration-connection-dialog.js";
import { IntegrationConnectionApiKeyDialog } from "../integrations/integration-connection-api-key-dialog.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { GitHubAppSetupPane } from "./integration-connection-github-app-setup-page.js";
import { SlackAppSetupPane } from "./integration-connection-slack-app-setup-page.js";
import {
  buildIntegrationConnectionDetailItems,
  resolveIntegrationConnectionDetailWebhookPolicy,
} from "./integrations-page-view-model.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";
import { useIntegrationConnectionEditors } from "./use-integration-connection-editors.js";
import { useIntegrationWebhookSourceState } from "./use-integration-webhook-source-state.js";
import {
  SETTINGS_INTEGRATIONS_QUERY_KEY,
  useIntegrationsDirectoryState,
} from "./use-integrations-directory-state.js";

function isUninstalledGitHubAppConnection(input: {
  connectionMethodId: string | undefined;
  config: Record<string, unknown> | undefined;
  externalSubjectId: string | undefined;
}): boolean {
  if (input.connectionMethodId !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION) {
    return false;
  }

  const installationId =
    typeof input.config?.["installation_id"] === "string"
      ? input.config["installation_id"]
      : typeof input.externalSubjectId === "string"
        ? input.externalSubjectId
        : null;

  return installationId === null;
}

function isIncompleteSlackAppConnection(input: {
  connectionMethodId: string | undefined;
  configuredSecretNames: readonly string[] | undefined;
}): boolean {
  return (
    input.connectionMethodId === SlackConnectionMethodId &&
    (!(input.configuredSecretNames?.includes("botToken") ?? false) ||
      !(input.configuredSecretNames?.includes("signingSecret") ?? false))
  );
}

type GitHubAppInstallationState = {
  errorMessage?: string;
  isPending: boolean;
};

type GitHubAppInstallationStateEntry = [string, GitHubAppInstallationState];

type InstalledAppSuccessNotice = {
  message?: string;
  resetKey: string;
  title: string;
};

function buildGitHubAppInstallationStateByConnectionId(input: {
  connections: readonly {
    id: string;
  }[];
  errorMessageByConnectionId: Readonly<Record<string, string | undefined>>;
  pendingConnectionId: string | null | undefined;
}): ReadonlyMap<string, GitHubAppInstallationState> {
  return new Map(
    input.connections.map((connection): GitHubAppInstallationStateEntry => {
      const errorMessage = input.errorMessageByConnectionId[connection.id];

      return [
        connection.id,
        {
          ...(errorMessage === undefined ? {} : { errorMessage }),
          isPending: input.pendingConnectionId === connection.id,
        },
      ];
    }),
  );
}

function resolveInstalledAppSuccessNotice(input: {
  detailConnectionId: string | null;
  searchParams: URLSearchParams;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId" | "id"> | undefined;
}): InstalledAppSuccessNotice | null {
  if (
    input.detailConnectionId === null ||
    input.selectedConnection?.id !== input.detailConnectionId
  ) {
    return null;
  }

  if (
    input.searchParams.get("slackApp") === "installed" &&
    input.selectedConnection.connectionMethodId === SlackConnectionMethodId
  ) {
    return {
      message: "The Slack app was created in Slack and connected to Mistle.",
      resetKey: input.detailConnectionId,
      title: "Slack app installed and connected",
    };
  }

  if (
    input.searchParams.get("githubApp") === "installed" &&
    input.selectedConnection.connectionMethodId ===
      IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return {
      resetKey: input.detailConnectionId,
      title: "GitHub App connected to Mistle successfully",
    };
  }

  return null;
}

function resolveManagedWebhookSetupMessage(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("managedWebhookSetupMessage" in state)) {
    return null;
  }

  const message = state.managedWebhookSetupMessage;
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

export function IntegrationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  useRequiredOrganizationId();
  const detailTargetKey = params["targetKey"] ?? null;
  const detailConnectionId = searchParams.get("connectionId");
  const dashboardConfig = getDashboardConfig();
  const directoryState = useIntegrationsDirectoryState({
    detailConnectionId,
    detailTargetKey,
  });

  const connectionEditors = useIntegrationConnectionEditors({
    connections: directoryState.selectedDetailConnections,
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });
  const webhookSourceState = useIntegrationWebhookSourceState({
    detailConnections: directoryState.selectedDetailConnections,
  });
  const githubAppInstallationStateByConnectionId = buildGitHubAppInstallationStateByConnectionId({
    connections: directoryState.selectedDetailConnections,
    errorMessageByConnectionId: connectionEditors.githubAppInstallation.errorMessageByConnectionId,
    pendingConnectionId: connectionEditors.githubAppInstallation.pendingConnectionId,
  });

  if (
    detailTargetKey !== null &&
    !directoryState.integrationsQuery.isPending &&
    !directoryState.integrationsQuery.isError &&
    directoryState.selectedDetailCard === null
  ) {
    throw new Error(`Integration target '${detailTargetKey}' was not found.`);
  }

  const selectedWebhookPolicy =
    directoryState.selectedDetailCard === null
      ? undefined
      : resolveIntegrationConnectionDetailWebhookPolicy({
          webhookSource: directoryState.selectedDetailCard.target.webhookSource,
        });

  const selectedDetailConnection =
    directoryState.selectedDetailConnections.find(
      (connection) => connection.id === directoryState.activeDetailConnectionId,
    ) ?? directoryState.selectedDetailConnections[0];
  const installedAppSuccessNotice = resolveInstalledAppSuccessNotice({
    detailConnectionId,
    searchParams,
    selectedConnection: selectedDetailConnection,
  });
  const managedWebhookSetupMessage = resolveManagedWebhookSetupMessage(location.state);
  const shouldShowManagedWebhookSetupFailureNotice =
    searchParams.get("managedWebhookSetup") === "failed" &&
    managedWebhookSetupMessage !== null &&
    detailConnectionId !== null &&
    selectedDetailConnection?.id === detailConnectionId;

  if (directoryState.integrationsQuery.isPending) {
    return null;
  }

  const detailSurface =
    detailTargetKey === null || directoryState.selectedDetailCard === null ? null : (
      <IntegrationConnectionDetailView
        connections={buildIntegrationConnectionDetailItems({
          connections: directoryState.selectedDetailConnections,
          controlPlaneApiOrigin: dashboardConfig.controlPlaneApiOrigin,
          githubAppInstallationStateByConnectionId,
          refreshingConnectionIds: directoryState.refreshingConnectionIds,
          refreshingResourceKeys: directoryState.refreshingResourceKeys,
          ...(directoryState.selectedDetailCard === null
            ? {}
            : {
                targetConfig: Object.fromEntries(
                  Object.entries(
                    typeof directoryState.selectedDetailCard.target.config === "object" &&
                      directoryState.selectedDetailCard.target.config !== null &&
                      !Array.isArray(directoryState.selectedDetailCard.target.config)
                      ? directoryState.selectedDetailCard.target.config
                      : {},
                  ),
                ),
                ...(directoryState.selectedDetailCard.target.connectionMethods === undefined
                  ? {}
                  : {
                      targetConnectionMethods:
                        directoryState.selectedDetailCard.target.connectionMethods,
                    }),
                targetFamilyId: directoryState.selectedDetailCard.target.familyId,
                targetVariantId: directoryState.selectedDetailCard.target.variantId,
              }),
        })}
        onSelectedConnectionChange={directoryState.setActiveDetailConnectionId}
        onDeleteConnection={connectionEditors.onDeleteConnection}
        onEditAuthentication={(connectionId) => {
          const editingConnection =
            directoryState.selectedDetailConnections.find(
              (connection) => connection.id === connectionId,
            ) ?? null;
          if (editingConnection === null) {
            throw new Error(`Integration connection '${connectionId}' was not found.`);
          }

          if (editingConnection.connectionMethodId === "api-key") {
            connectionEditors.onEditApiKey(connectionId);
            return;
          }

          void navigate(`/integrations/${detailTargetKey}/${connectionId}/edit${location.search}`);
        }}
        onStartGitHubAppInstallation={connectionEditors.githubAppInstallation.onStartInstallation}
        onRefreshResource={directoryState.onRefreshResource}
        selectedConnectionId={directoryState.activeDetailConnectionId}
        selectedConnectionBody={
          selectedDetailConnection !== undefined &&
          isUninstalledGitHubAppConnection({
            connectionMethodId: selectedDetailConnection.connectionMethodId,
            config: selectedDetailConnection.config,
            externalSubjectId: selectedDetailConnection.externalSubjectId,
          }) ? (
            <GitHubAppSetupPane
              connection={selectedDetailConnection}
              key={selectedDetailConnection.id}
            />
          ) : selectedDetailConnection !== undefined &&
            isIncompleteSlackAppConnection({
              connectionMethodId: selectedDetailConnection.connectionMethodId,
              configuredSecretNames: selectedDetailConnection.configuredSecretNames,
            }) ? (
            <SlackAppSetupPane
              connection={selectedDetailConnection}
              key={selectedDetailConnection.id}
            />
          ) : undefined
        }
        selectedConnectionNotice={
          installedAppSuccessNotice !== null ? (
            <Notice
              autoHideAfterMs={NoticeAutoHideDurationsMs.LONG}
              dismissible
              resetKey={installedAppSuccessNotice.resetKey}
              title={installedAppSuccessNotice.title}
              variant="success"
            >
              {installedAppSuccessNotice.message ?? null}
            </Notice>
          ) : shouldShowManagedWebhookSetupFailureNotice ? (
            <Notice title="Connection created, webhook setup failed" variant="alert">
              {managedWebhookSetupMessage}
            </Notice>
          ) : undefined
        }
        webhookSourceStateByConnectionId={webhookSourceState.webhookSourceStateByConnectionId}
        onCreateWebhookSource={({ connectionId }) => {
          webhookSourceState.createWebhookSource({ connectionId });
        }}
        onDeleteWebhookSource={({ connectionId, webhookSourceId }) => {
          webhookSourceState.deleteWebhookSource({
            connectionId,
            webhookSourceId,
          });
        }}
        webhookPolicy={selectedWebhookPolicy}
        titleEditor={connectionEditors.titleEditor}
      />
    );

  return (
    <OrganizationIntegrationsSettingsPageView
      availableCards={directoryState.availableViewCards}
      connectedCards={directoryState.connectedViewCards}
      connectionDialog={
        <>
          <IntegrationConnectionApiKeyDialog {...connectionEditors.apiKeyDialog} />
          <DeleteIntegrationConnectionDialog {...connectionEditors.deleteDialog} />
        </>
      }
      detailSurface={detailSurface}
      loadErrorMessage={
        directoryState.integrationsQuery.isError
          ? resolveApiErrorMessage({
              error: directoryState.integrationsQuery.error,
              fallbackMessage: "Could not load integrations.",
            })
          : null
      }
    />
  );
}
