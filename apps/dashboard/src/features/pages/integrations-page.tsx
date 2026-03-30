import { useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { DeleteIntegrationConnectionDialog } from "../integrations/delete-integration-connection-dialog.js";
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

  const detailSurface =
    detailTargetKey === null || directoryState.selectedDetailCard === null ? null : (
      <IntegrationConnectionDetailView
        connections={buildIntegrationConnectionDetailItems({
          connections: directoryState.selectedDetailConnections,
          refreshingResourceKeys: directoryState.refreshingResourceKeys,
        })}
        onDeleteConnection={connectionEditors.onDeleteConnection}
        onEditApiKey={connectionEditors.onEditApiKey}
        onRefreshResource={directoryState.onRefreshResource}
        resourceItemsByKey={directoryState.resourceItemsByKey}
        titleEditor={connectionEditors.titleEditor}
      />
    );

  return (
    <OrganizationIntegrationsSettingsPageView
      availableCards={directoryState.availableViewCards}
      connectedCards={directoryState.connectedViewCards}
      connectionDialog={
        <>
          <IntegrationConnectionDialog
            configForm={connectionDialogState.configForm}
            configValue={connectionDialogState.configValue}
            connectionDisplayNamePlaceholder={
              connectionDialogState.connectionDisplayNamePlaceholder
            }
            connectionDisplayNameValue={connectionDialogState.connectionDisplayNameValue}
            connectError={connectionDialogState.error}
            dialog={connectionDialogState.dialog}
            hasChanges={connectionDialogState.hasChanges}
            isConnectionDisplayNameChanged={connectionDialogState.isConnectionDisplayNameChanged}
            isSecretChanged={connectionDialogState.isSecretChanged}
            methodId={connectionDialogState.methodId}
            onClose={connectionDialogState.closeDialog}
            onConfigChange={connectionDialogState.onConfigChange}
            onConnectionDisplayNameChange={connectionDialogState.onConnectionDisplayNameChange}
            onMethodChange={connectionDialogState.onMethodChange}
            onSecretChange={connectionDialogState.onSecretChange}
            onSubmit={connectionDialogState.submitDialog}
            pending={connectionDialogState.pending}
            secrets={connectionDialogState.secrets}
          />
          <IntegrationConnectionApiKeyDialog {...connectionEditors.apiKeyDialog} />
          <DeleteIntegrationConnectionDialog {...connectionEditors.deleteDialog} />
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
