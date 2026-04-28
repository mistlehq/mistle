import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { Notice, NoticeAutoHideDurationsMs } from "@mistle/ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteIntegrationConnectionDialog } from "../integrations/delete-integration-connection-dialog.js";
import { IntegrationConnectionApiKeyDialog } from "../integrations/integration-connection-api-key-dialog.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  ManagedWebhookSetupResultSchema,
  type ManagedWebhookSetupResult,
} from "../integrations/integrations-service-shared.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { renderIntegrationConnectionSetupPane } from "./integration-connection-setup-pane-registry.js";
import { resolveIncompleteIntegrationConnectionSetupFlow } from "./integration-connection-setup-state.js";
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

type GitHubAppInstallationState = {
  errorMessage?: string;
  isPending: boolean;
};

type GitHubAppInstallationStateEntry = [string, GitHubAppInstallationState];

type ConnectionNotice = {
  connectionId: string;
  message?: string;
  resetKey: string;
  title: string;
  variant: "alert" | "success";
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

function clearUrlConnectionNoticeParams(searchParams: URLSearchParams): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  nextSearchParams.delete("connectionNotice");
  return nextSearchParams;
}

function resolveUrlConnectionNotice(input: {
  detailConnectionId: string | null;
  searchParams: URLSearchParams;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId" | "id"> | undefined;
}): ConnectionNotice | null {
  if (
    input.detailConnectionId === null ||
    input.selectedConnection?.id !== input.detailConnectionId
  ) {
    return null;
  }

  if (input.searchParams.get("connectionNotice") !== "installed") {
    return null;
  }

  if (input.selectedConnection.connectionMethodId === SlackConnectionMethodId) {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `slack-installed:${input.detailConnectionId}`,
      title: "The Slack app was created and connected to Mistle successfully",
      variant: "success",
    };
  }

  if (
    input.selectedConnection.connectionMethodId ===
    IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION
  ) {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `github-installed:${input.detailConnectionId}`,
      title: "GitHub App connected to Mistle successfully",
      variant: "success",
    };
  }

  return null;
}

function resolveRouteStateConnectionNotice(input: {
  detailConnectionId: string | null;
  locationState: unknown;
  selectedConnection: Pick<IntegrationConnection, "id" | "targetKey"> | undefined;
}): ConnectionNotice | null {
  if (
    input.detailConnectionId === null ||
    input.selectedConnection?.id !== input.detailConnectionId
  ) {
    return null;
  }

  const managedWebhookSetup = resolveManagedWebhookSetupState(input.locationState);
  if (managedWebhookSetup === null || input.selectedConnection.targetKey !== "jira-default") {
    return null;
  }

  if (managedWebhookSetup.status === "created") {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `jira-webhook-created:${input.detailConnectionId}`,
      title: "Jira connection and webhook created successfully",
      variant: "success",
    };
  }

  return {
    connectionId: input.detailConnectionId,
    message: managedWebhookSetup.message,
    resetKey: `jira-webhook-failed:${input.detailConnectionId}`,
    title: "Connection created, webhook setup failed",
    variant: "alert",
  };
}

function resolveManagedWebhookSetupState(state: unknown): ManagedWebhookSetupResult | null {
  if (typeof state !== "object" || state === null || !("managedWebhookSetup" in state)) {
    return null;
  }

  const parsed = ManagedWebhookSetupResultSchema.safeParse(state.managedWebhookSetup);
  return parsed.success ? parsed.data : null;
}

export function IntegrationsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [urlConnectionNotice, setUrlConnectionNotice] = useState<ConnectionNotice | null>(null);
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
  const routeStateConnectionNotice = resolveRouteStateConnectionNotice({
    detailConnectionId,
    locationState: location.state,
    selectedConnection: selectedDetailConnection,
  });
  const connectionNotice =
    routeStateConnectionNotice ??
    (urlConnectionNotice?.connectionId === selectedDetailConnection?.id
      ? urlConnectionNotice
      : null);
  const selectedDetailConnectionSetupFlow =
    selectedDetailConnection === undefined
      ? null
      : resolveIncompleteIntegrationConnectionSetupFlow({
          connection: selectedDetailConnection,
          connectionMethods: directoryState.selectedDetailCard?.target.connectionMethods,
        });

  useEffect(() => {
    const resolvedUrlNotice = resolveUrlConnectionNotice({
      detailConnectionId,
      searchParams,
      selectedConnection: selectedDetailConnection,
    });

    if (resolvedUrlNotice === null) {
      return;
    }

    setUrlConnectionNotice(resolvedUrlNotice);
    setSearchParams(clearUrlConnectionNoticeParams(searchParams), { replace: true });
  }, [detailConnectionId, searchParams, selectedDetailConnection, setSearchParams]);

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
        selectedConnectionBody={renderSelectedConnectionSetupBody({
          connection: selectedDetailConnection,
          setupFlow: selectedDetailConnectionSetupFlow,
        })}
        selectedConnectionNotice={
          connectionNotice !== null ? (
            <Notice
              autoHideAfterMs={NoticeAutoHideDurationsMs.LONG}
              dismissible
              resetKey={connectionNotice.resetKey}
              title={connectionNotice.title}
              variant={connectionNotice.variant}
            >
              {connectionNotice.message ?? null}
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

function renderSelectedConnectionSetupBody(input: {
  connection: IntegrationConnection | undefined;
  setupFlow: { routeSegment: string } | null;
}): React.JSX.Element | undefined {
  if (input.connection === undefined || input.setupFlow === null) {
    return undefined;
  }

  return renderIntegrationConnectionSetupPane({
    connection: input.connection,
    routeSegment: input.setupFlow.routeSegment,
  });
}
