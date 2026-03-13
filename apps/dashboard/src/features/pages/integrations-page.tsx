import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { resolveConnectionAuthScheme } from "../integrations/connection-auth.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
} from "../integrations/integration-connection-dialog.js";
import {
  listIntegrationDirectory,
  refreshIntegrationConnectionResources,
} from "../integrations/integrations-service.js";
import {
  buildAvailableIntegrationViewCards,
  buildConnectedIntegrationViewCards,
  buildIntegrationConnectionDetailItems,
  createRefreshingResourceKey,
} from "./integrations-page-view-model.js";
import { OrganizationIntegrationsSettingsPageView } from "./organization-integrations-settings-page-view.js";
import { useIntegrationConnectionDialogState } from "./use-integration-connection-dialog-state.js";
import { useIntegrationDetailState } from "./use-integration-detail-state.js";

const SETTINGS_INTEGRATIONS_QUERY_KEY: readonly ["settings", "integrations", "directory"] = [
  "settings",
  "integrations",
  "directory",
];

export function IntegrationsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const detailTargetKey = params["targetKey"] ?? null;

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

  const [refreshingResourceKeys, setRefreshingResourceKeys] = useState<Set<string>>(
    () => new Set<string>(),
  );

  const connectedIntegrationCards = useMemo(
    () => cards.filter((card) => card.connections.length > 0),
    [cards],
  );

  const {
    selectedConnectionId,
    setSelectedConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
  } = useIntegrationDetailState({
    cards,
    detailTargetKey,
  });

  if (
    detailTargetKey !== null &&
    !integrationsQuery.isPending &&
    !integrationsQuery.isError &&
    selectedDetailCard === null
  ) {
    throw new Error(`Integration target '${detailTargetKey}' was not found.`);
  }

  const refreshResourceMutation = useMutation({
    mutationFn: async (input: { connectionId: string; kind: string }) =>
      refreshIntegrationConnectionResources(input),
    onMutate: (variables) => {
      setRefreshingResourceKeys((current) => {
        const next = new Set(current);
        next.add(createRefreshingResourceKey(variables));
        return next;
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });
    },
    onSettled: (_data, _error, variables) => {
      setRefreshingResourceKeys((current) => {
        const next = new Set(current);
        next.delete(createRefreshingResourceKey(variables));
        return next;
      });
    },
  });

  const connectedViewCards = useMemo(
    () =>
      buildConnectedIntegrationViewCards({
        connectedCards: connectedIntegrationCards,
        onOpenTarget: (targetKey) => {
          void navigate(`/settings/organization/integrations/${targetKey}`);
        },
      }),
    [connectedIntegrationCards, navigate],
  );

  const availableViewCards = useMemo(
    () =>
      buildAvailableIntegrationViewCards({
        cards,
        onOpenCreateDialog: (dialogInput) => {
          connectionDialogState.openDialog(dialogInput);
        },
      }),
    [cards, connectionDialogState],
  );

  const detailSurface = useMemo(() => {
    if (detailTargetKey === null || selectedDetailCard === null) {
      return null;
    }

    return (
      <IntegrationConnectionDetailView
        connections={buildIntegrationConnectionDetailItems({
          connections: selectedDetailConnections,
          refreshingResourceKeys,
        })}
        {...(selectedDetailCard.target.logoKey === undefined
          ? {}
          : { logoKey: selectedDetailCard.target.logoKey })}
        onEditConnection={(connectionId) => {
          const selectedConnection = selectedDetailConnections.find(
            (connection) => connection.id === connectionId,
          );
          if (selectedConnection === undefined) {
            throw new Error(`Integration connection '${connectionId}' was not found.`);
          }

          const authScheme = resolveConnectionAuthScheme(selectedConnection.config ?? null);
          connectionDialogState.openDialog({
            targetKey: selectedDetailCard.target.targetKey,
            targetDisplayName: selectedDetailCard.displayName,
            mode: "update",
            connectionId: selectedConnection.id,
            connectionDisplayName: selectedConnection.displayName,
            currentMethodId:
              authScheme === null ? IntegrationConnectionMethodIds.API_KEY : authScheme,
          });
        }}
        onRefreshResource={(input) => {
          refreshResourceMutation.mutate(input);
        }}
        onSelectConnection={setSelectedConnectionId}
        selectedConnectionId={selectedConnectionId}
        targetDisplayName={selectedDetailCard.displayName}
        targetKey={selectedDetailCard.target.targetKey}
      />
    );
  }, [
    connectionDialogState,
    detailTargetKey,
    refreshingResourceKeys,
    selectedConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
  ]);

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
      detailSurface={detailSurface}
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
