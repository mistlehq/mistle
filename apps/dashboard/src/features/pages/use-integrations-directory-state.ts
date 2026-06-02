import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { buildIntegrationCards } from "../integrations/directory-model.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import {
  buildAvailableIntegrationViewCards,
  buildConnectedIntegrationViewCards,
  shouldAutoRefreshIntegrationConnectionResources,
} from "./integrations-page-view-model.js";
import { useIntegrationDetailState } from "./use-integration-detail-state.js";
import {
  shouldPollIntegrationDirectory,
  useIntegrationResourceState,
} from "./use-integration-resource-state.js";

export const SETTINGS_INTEGRATIONS_QUERY_KEY: readonly ["settings", "integrations", "directory"] = [
  "settings",
  "integrations",
  "directory",
];

export function useIntegrationsDirectoryState(input: {
  detailTargetKey: string | null;
  detailConnectionId: string | null;
}) {
  const activeDetailConnectionIdRef = useRef<string | null>(null);
  const autoRefreshStartedConnectionIdsRef = useRef<Set<string>>(new Set());

  const integrationsQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
    refetchInterval: (query) => {
      return shouldPollIntegrationDirectory({
        activeDetailConnectionId: activeDetailConnectionIdRef.current,
        detailTargetKey: input.detailTargetKey,
        directoryData: query.state.data,
      })
        ? 3_000
        : false;
    },
  });

  const cards =
    integrationsQuery.data === undefined ? [] : buildIntegrationCards(integrationsQuery.data);

  const connectedIntegrationCards = cards.filter((card) => card.connections.length > 0);

  const {
    activeDetailConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
    setActiveDetailConnectionId,
  } = useIntegrationDetailState({
    cards,
    detailConnectionId: input.detailConnectionId,
    detailTargetKey: input.detailTargetKey,
  });
  activeDetailConnectionIdRef.current = activeDetailConnectionId;

  const resourceState = useIntegrationResourceState({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });
  const selectedDetailConnection =
    selectedDetailConnections.find((connection) => connection.id === activeDetailConnectionId) ??
    null;
  const shouldAutoRefreshResources = shouldAutoRefreshIntegrationConnectionResources({
    connection: selectedDetailConnection,
    routeConnectionId: input.detailConnectionId,
  });

  useEffect(() => {
    if (
      selectedDetailConnection === null ||
      !shouldAutoRefreshResources ||
      autoRefreshStartedConnectionIdsRef.current.has(selectedDetailConnection.id)
    ) {
      return;
    }

    autoRefreshStartedConnectionIdsRef.current.add(selectedDetailConnection.id);
    resourceState.onRefreshAllResources({
      connectionId: selectedDetailConnection.id,
    });
  }, [resourceState.onRefreshAllResources, selectedDetailConnection, shouldAutoRefreshResources]);

  const connectedViewCards = buildConnectedIntegrationViewCards({
    connectedCards: connectedIntegrationCards,
  });

  const availableViewCards = buildAvailableIntegrationViewCards({
    cards,
  });

  return {
    availableViewCards,
    cards,
    connectedViewCards,
    integrationsQuery,
    activeDetailConnectionId,
    refreshingConnectionIds: resourceState.refreshingConnectionIds,
    setActiveDetailConnectionId,
    onRefreshResource: resourceState.onRefreshResource,
    refreshingResourceKeys: resourceState.refreshingResourceKeys,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
