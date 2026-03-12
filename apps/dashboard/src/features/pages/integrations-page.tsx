import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  formatConnectionAuthMethodLabel,
  resolveConnectionAuthScheme,
} from "../integrations/connection-auth.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import { formatConnectionCount } from "../integrations/format-connection-count.js";
import { IntegrationConnectionDetailView } from "../integrations/integration-connection-detail-view.js";
import {
  IntegrationConnectionDialog,
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-dialog.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import { refreshIntegrationConnectionResources } from "../integrations/integrations-service.js";
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
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const detailTargetKey = params["targetKey"] ?? null;
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

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

  const activeIntegrationCards = useMemo(
    () =>
      cards.filter((card) => card.connections.some((connection) => connection.status === "active")),
    [cards],
  );

  const selectedDetailCard = useMemo(() => {
    if (detailTargetKey === null) {
      return null;
    }

    return cards.find((card) => card.target.targetKey === detailTargetKey) ?? null;
  }, [cards, detailTargetKey]);

  const selectedDetailConnections = useMemo(() => {
    if (selectedDetailCard === null) {
      return [];
    }

    return selectedDetailCard.connections.filter((connection) => connection.status === "active");
  }, [selectedDetailCard]);

  useEffect(() => {
    const defaultConnection = selectedDetailConnections[0] ?? null;
    if (defaultConnection === null) {
      setSelectedConnectionId(null);
      return;
    }

    const selectedStillExists = selectedDetailConnections.some(
      (connection) => connection.id === selectedConnectionId,
    );
    if (!selectedStillExists) {
      setSelectedConnectionId(defaultConnection.id);
    }
  }, [selectedConnectionId, selectedDetailConnections]);

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
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });
    },
  });

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
          void navigate(`/settings/organization/integrations/${card.target.targetKey}`);
        },
      })),
    [activeIntegrationCards, navigate],
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

  const detailSurface = useMemo(() => {
    if (detailTargetKey === null || selectedDetailCard === null) {
      return null;
    }

    return (
      <IntegrationConnectionDetailView
        connections={selectedDetailConnections.map((connection) => {
          const authScheme = resolveConnectionAuthScheme(connection.config ?? null);

          return {
            id: connection.id,
            displayName: connection.displayName,
            status: connection.status,
            ...(authScheme === null
              ? {}
              : { authMethodLabel: formatConnectionAuthMethodLabel(authScheme) }),
            ...(connection.externalSubjectId === undefined
              ? {}
              : { externalSubjectId: connection.externalSubjectId }),
            createdAt: connection.createdAt,
            updatedAt: connection.updatedAt,
            resources: (connection.resources ?? []).map((resource) => ({
              kind: resource.kind,
              selectionMode: resource.selectionMode,
              count: resource.count,
              syncState: resource.syncState,
              ...(resource.lastSyncedAt === undefined
                ? {}
                : { lastSyncedAt: resource.lastSyncedAt }),
              isRefreshing:
                refreshResourceMutation.isPending &&
                refreshResourceMutation.variables?.connectionId === connection.id &&
                refreshResourceMutation.variables.kind === resource.kind,
            })),
          };
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
    refreshResourceMutation,
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
