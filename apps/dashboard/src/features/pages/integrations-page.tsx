import { Notice, NoticeAutoHideDurationsMs } from "@mistle/ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteIntegrationConnectionDialog } from "../integrations/delete-integration-connection-dialog.js";
import { IntegrationConnectionApiKeyDialog } from "../integrations/integration-connection-api-key-dialog.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import { resolveFormConnectionMethodManagedWebhookSourcePostCreate } from "../integrations/integration-connection-method-metadata.js";
import {
  resolveInstalledIntegrationConnectionNotice,
  type IntegrationConnectionNotice,
} from "../integrations/integration-connection-notices.js";
import { useIntegrationWebhookSourceActions } from "../integrations/integration-webhook-source-actions.js";
import {
  ManagedWebhookSetupResultSchema,
  type IntegrationConnectionMethod,
  type IntegrationManagedWebhookSourcePostCreate,
  type ManagedWebhookSetupResult,
} from "../integrations/integrations-service-shared.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useRequiredOrganizationId } from "../shell/require-auth.js";
import { renderIntegrationConnectionSetupPane } from "./integration-connection-setup-pane-registry.js";
import {
  type IntegrationConnectionSetupRoute,
  resolveIncompleteIntegrationConnectionSetupFlow,
} from "./integration-connection-setup-state.js";
import {
  buildIntegrationConnectionDetailItems,
  type ProviderAppSetupState,
  resolveIntegrationConnectionDetailWebhookPolicy,
} from "./integrations-page-view-model.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";
import { useIntegrationConnectionEditors } from "./use-integration-connection-editors.js";
import { useIntegrationWebhookSourceState } from "./use-integration-webhook-source-state.js";
import {
  SETTINGS_INTEGRATIONS_QUERY_KEY,
  useIntegrationsDirectoryState,
} from "./use-integrations-directory-state.js";

function buildProviderAppSetupStateByConnectionId(input: {
  connections: readonly {
    id: string;
  }[];
  errorMessageByConnectionId: Readonly<Record<string, string | undefined>>;
  pendingConnectionId: string | null | undefined;
}): ReadonlyMap<string, ProviderAppSetupState> {
  return new Map(
    input.connections.map((connection) => {
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

function resolveRouteStateConnectionNotice(input: {
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  detailConnectionId: string | null;
  locationState: unknown;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId" | "id"> | undefined;
}): IntegrationConnectionNotice | null {
  if (
    input.detailConnectionId === null ||
    input.selectedConnection?.id !== input.detailConnectionId
  ) {
    return null;
  }

  const managedWebhookSetup = resolveManagedWebhookSetupState(input.locationState);
  const managedWebhookSourcePostCreate = resolveManagedWebhookSourcePostCreate({
    connectionMethods: input.connectionMethods,
    selectedConnection: input.selectedConnection,
  });
  if (managedWebhookSetup === null || managedWebhookSourcePostCreate === null) {
    return null;
  }

  if (managedWebhookSetup.status === "created") {
    return {
      connectionId: input.detailConnectionId,
      resetKey: `managed-webhook-created:${input.detailConnectionId}`,
      title: managedWebhookSourcePostCreate.successNoticeTitle,
      variant: "success",
    };
  }

  return {
    connectionId: input.detailConnectionId,
    message: managedWebhookSetup.message,
    resetKey: `managed-webhook-failed:${input.detailConnectionId}`,
    title: managedWebhookSourcePostCreate.failureNoticeTitle,
    variant: "alert",
  };
}

function resolveManagedWebhookSourcePostCreate(input: {
  connectionMethods: readonly IntegrationConnectionMethod[] | undefined;
  selectedConnection: Pick<IntegrationConnection, "connectionMethodId"> | undefined;
}): IntegrationManagedWebhookSourcePostCreate | null {
  const connectionMethodId = input.selectedConnection?.connectionMethodId;
  if (connectionMethodId === undefined) {
    return null;
  }

  const method =
    input.connectionMethods?.find((candidate) => candidate.id === connectionMethodId) ?? null;
  return resolveFormConnectionMethodManagedWebhookSourcePostCreate(method);
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
  const [urlConnectionNotice, setUrlConnectionNotice] =
    useState<IntegrationConnectionNotice | null>(null);
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
    connectionMethods: directoryState.selectedDetailCard?.target.connectionMethods,
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });
  const webhookSourceState = useIntegrationWebhookSourceState({
    detailConnections: directoryState.selectedDetailConnections,
  });
  const webhookSourceActions = useIntegrationWebhookSourceActions({
    connections: directoryState.selectedDetailConnections,
    refreshTriggerCapabilities: webhookSourceState.refreshTriggerCapabilities,
    refreshingTriggerCapabilitiesConnectionId:
      webhookSourceState.refreshingTriggerCapabilitiesConnectionId,
  });
  const providerAppSetupStateByConnectionId = buildProviderAppSetupStateByConnectionId({
    connections: directoryState.selectedDetailConnections,
    errorMessageByConnectionId: connectionEditors.providerAppSetup.errorMessageByConnectionId,
    pendingConnectionId: connectionEditors.providerAppSetup.pendingConnectionId,
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
    connectionMethods: directoryState.selectedDetailCard?.target.connectionMethods,
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
    const resolvedUrlNotice = resolveInstalledIntegrationConnectionNotice({
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
          providerAppSetupStateByConnectionId,
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
        onStartProviderAppSetup={connectionEditors.providerAppSetup.onStartInstallation}
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
        {...(directoryState.selectedDetailCard?.target.supportedWebhookEvents === undefined
          ? {}
          : {
              supportedWebhookEvents:
                directoryState.selectedDetailCard.target.supportedWebhookEvents,
            })}
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
        renderWebhookSourceActions={webhookSourceActions.renderWebhookSourceActions}
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
          {webhookSourceActions.dialog}
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
  setupFlow: IntegrationConnectionSetupRoute | null;
}): React.JSX.Element | undefined {
  if (input.connection === undefined || input.setupFlow === null) {
    return undefined;
  }

  return renderIntegrationConnectionSetupPane({
    connection: input.connection,
    setupRoute: input.setupFlow,
  });
}
