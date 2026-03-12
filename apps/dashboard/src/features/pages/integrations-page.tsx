import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import {
  type ViewDialogState,
  ViewConnectionsDialog,
} from "../integrations/view-connections-dialog.js";
import {
  OrganizationIntegrationsSettingsPageView,
  type OrganizationIntegrationsSettingsPageCard,
} from "./organization-integrations-settings-page-view.js";
import { useIntegrationConnectionDialogState } from "./use-integration-connection-dialog-state.js";

const SETTINGS_INTEGRATIONS_QUERY_KEY: readonly ["settings", "integrations", "directory"] = [
  "settings",
  "integrations",
  "directory",
];

function toConnectionMethods(
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

export function IntegrationsPage() {
  const [viewDialog, setViewDialog] = useState<ViewDialogState | null>(null);

  const connectionDialogState = useIntegrationConnectionDialogState({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  const cards = useMemo(() => {
    if (!integrationsQuery.data) {
      return [];
    }

    return buildIntegrationCards(integrationsQuery.data);
  }, [integrationsQuery.data]);

  const selectedViewConnections = useMemo(() => {
    if (viewDialog === null) {
      return [];
    }

    const selectedCard = cards.find((card) => card.target.targetKey === viewDialog.targetKey);
    if (selectedCard === undefined) {
      throw new Error(`Integration card was not found for target '${viewDialog.targetKey}'.`);
    }

    return selectedCard.connections.filter((connection) => connection.status === "active");
  }, [cards, viewDialog]);

  const activeIntegrationCards = useMemo(
    () =>
      cards.filter((card) => card.connections.some((connection) => connection.status === "active")),
    [cards],
  );

  const connectedViewCards = useMemo<readonly OrganizationIntegrationsSettingsPageCard[]>(
    () =>
      activeIntegrationCards.map((card) => ({
        targetKey: card.target.targetKey,
        displayName: card.displayName,
        description: formatConnectionCount(card.connections.length),
        configStatus: card.configStatus,
        ...(card.target.logoKey === undefined ? {} : { logoKey: card.target.logoKey }),
        actionLabel: "View",
        onAction: () => {
          setViewDialog({
            targetKey: card.target.targetKey,
            displayName: card.displayName,
          });
        },
      })),
    [activeIntegrationCards],
  );

  const availableViewCards = useMemo<readonly OrganizationIntegrationsSettingsPageCard[]>(
    () =>
      cards.map((card) => {
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
            connectionDialogState.openDialog({
              targetKey: card.target.targetKey,
              targetDisplayName: card.displayName,
              methods,
              mode: "create",
            });
          },
        };
      }),
    [cards, connectionDialogState],
  );

  return (
    <OrganizationIntegrationsSettingsPageView
      availableCards={availableViewCards}
      connectedCards={connectedViewCards}
      connectionDialog={
        <IntegrationConnectionDialog
          apiKeyValue={connectionDialogState.apiKeyValue}
          connectionDisplayNamePlaceholder={connectionDialogState.connectionDisplayNamePlaceholder}
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
      }
      detailSurface={
        <ViewConnectionsDialog
          connections={selectedViewConnections}
          dialog={viewDialog}
          onClose={() => {
            setViewDialog(null);
          }}
          onOpenEditConnectionDialog={({
            connectionId,
            connectionDisplayName,
            connectionMethodId,
          }) => {
            if (viewDialog === null) {
              throw new Error("View dialog state is required to open edit connection dialog.");
            }

            setViewDialog(null);
            connectionDialogState.openDialog({
              targetKey: viewDialog.targetKey,
              targetDisplayName: viewDialog.displayName,
              mode: "update",
              connectionId,
              connectionDisplayName,
              currentMethodId:
                connectionMethodId === null
                  ? IntegrationConnectionMethodIds.API_KEY
                  : connectionMethodId,
            });
          }}
        />
      }
      isLoading={integrationsQuery.isPending}
      loadErrorMessage={
        integrationsQuery.isError
          ? resolveApiErrorMessage({
              error: integrationsQuery.error,
              fallbackMessage: "Could not load integrations.",
            })
          : null
      }
      onRetryLoad={() => {
        void integrationsQuery.refetch();
      }}
    />
  );
}
