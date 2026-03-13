import { useMemo } from "react";
import { useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { IntegrationConnectionApiKeyDialog } from "../integrations/integration-connection-api-key-dialog.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import { IntegrationConnectionDialog } from "../integrations/integration-connection-dialog.js";
import { buildIntegrationConnectionDetailItems } from "./integrations-page-view-model.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";
import { useIntegrationConnectionDialogState } from "./use-integration-connection-dialog-state.js";
import { useIntegrationConnectionEditors } from "./use-integration-connection-editors.js";
import {
  SETTINGS_INTEGRATIONS_QUERY_KEY,
  useIntegrationsDirectoryState,
} from "./use-integrations-directory-state.js";

export function IntegrationsPage() {
  const params = useParams();
  const detailTargetKey = params["targetKey"] ?? null;

  const connectionDialogState = useIntegrationConnectionDialogState({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  const directoryState = useIntegrationsDirectoryState({
    detailTargetKey,
    onOpenCreateDialog: (dialogInput) => {
      connectionDialogState.openDialog(dialogInput);
    },
  });

  const connectionEditors = useIntegrationConnectionEditors({
    connections: directoryState.selectedDetailConnections,
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  if (
    detailTargetKey !== null &&
    !directoryState.integrationsQuery.isPending &&
    !directoryState.integrationsQuery.isError &&
    directoryState.selectedDetailCard === null
  ) {
    throw new Error(`Integration target '${detailTargetKey}' was not found.`);
  }

  const detailSurface = useMemo(() => {
    if (detailTargetKey === null || directoryState.selectedDetailCard === null) {
      return null;
    }

    return (
      <IntegrationConnectionDetailView
        connections={buildIntegrationConnectionDetailItems({
          connections: directoryState.selectedDetailConnections,
          refreshingResourceKeys: directoryState.refreshingResourceKeys,
        })}
        onEditApiKey={connectionEditors.onEditApiKey}
        onRefreshResource={directoryState.onRefreshResource}
        resourceItemsByKey={directoryState.resourceItemsByKey}
        titleEditor={connectionEditors.titleEditor}
      />
    );
  }, [
    connectionEditors.onEditApiKey,
    connectionEditors.titleEditor,
    detailTargetKey,
    directoryState.onRefreshResource,
    directoryState.refreshingResourceKeys,
    directoryState.resourceItemsByKey,
    directoryState.selectedDetailCard,
    directoryState.selectedDetailConnections,
  ]);

  return (
    <OrganizationIntegrationsSettingsPageView
      availableCards={directoryState.availableViewCards}
      connectedCards={directoryState.connectedViewCards}
      connectionDialog={
        <>
          <IntegrationConnectionDialog
            apiKeyValue={connectionDialogState.apiKeyValue}
            connectionDisplayNamePlaceholder={
              connectionDialogState.connectionDisplayNamePlaceholder
            }
            connectionDisplayNameValue={connectionDialogState.connectionDisplayNameValue}
            connectError={connectionDialogState.error}
            connectMethodId={connectionDialogState.methodId}
            dialog={connectionDialogState.dialog}
            hasChanges={connectionDialogState.hasChanges}
            isApiKeyChanged={connectionDialogState.isApiKeyChanged}
            isConnectionDisplayNameChanged={connectionDialogState.isConnectionDisplayNameChanged}
            onApiKeyChange={connectionDialogState.onApiKeyChange}
            onConnectionDisplayNameChange={connectionDialogState.onConnectionDisplayNameChange}
            onClose={connectionDialogState.closeDialog}
            onMethodChange={connectionDialogState.onMethodChange}
            onSubmit={connectionDialogState.submitDialog}
            pending={connectionDialogState.pending}
          />
          <IntegrationConnectionApiKeyDialog {...connectionEditors.apiKeyDialog} />
        </>
      }
      detailSurface={detailSurface}
      isLoading={directoryState.integrationsQuery.isPending}
      loadErrorMessage={
        directoryState.integrationsQuery.isError
          ? resolveApiErrorMessage({
              error: directoryState.integrationsQuery.error,
              fallbackMessage: "Could not load integrations.",
            })
          : null
      }
      onRetryLoad={() => {
        void directoryState.integrationsQuery.refetch();
      }}
    />
  );
}
