import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { Notice } from "@mistle/ui";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteIntegrationConnectionDialog } from "../integrations/delete-integration-connection-dialog.js";
import { IntegrationConnectionApiKeyDialog } from "../integrations/integration-connection-api-key-dialog.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
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
  const githubAppInstallationStateByConnectionId = new Map(
    directoryState.selectedDetailConnections.map((connection) => {
      const errorMessage =
        connectionEditors.githubAppInstallation.errorMessageByConnectionId[connection.id];

      return [
        connection.id,
        {
          ...(errorMessage === undefined ? {} : { errorMessage }),
          isPending: connectionEditors.githubAppInstallation.pendingConnectionId === connection.id,
        },
      ] as const;
    }),
  );

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

  if (directoryState.integrationsQuery.isPending) {
    return null;
  }

  const selectedDetailConnection =
    directoryState.selectedDetailConnections.find(
      (connection) => connection.id === directoryState.activeDetailConnectionId,
    ) ?? directoryState.selectedDetailConnections[0];
  const shouldShowSlackInstallSuccessNotice =
    searchParams.get("slackApp") === "installed" &&
    detailConnectionId !== null &&
    selectedDetailConnection?.id === detailConnectionId &&
    selectedDetailConnection.connectionMethodId === SlackConnectionMethodId;

  const detailSurface =
    detailTargetKey === null || directoryState.selectedDetailCard === null ? null : (
      <IntegrationConnectionDetailView
        connections={buildIntegrationConnectionDetailItems({
          connections: directoryState.selectedDetailConnections,
          controlPlaneApiOrigin: dashboardConfig.controlPlaneApiOrigin,
          githubAppInstallationStateByConnectionId,
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
          shouldShowSlackInstallSuccessNotice ? (
            <Notice title="Slack app installed and connected" variant="success">
              The Slack app was created in Slack and connected to Mistle.
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
