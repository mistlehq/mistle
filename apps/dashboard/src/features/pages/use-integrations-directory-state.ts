import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router";

import { buildIntegrationCards } from "../integrations/directory-model.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import {
  buildAvailableIntegrationViewCards,
  buildConnectedIntegrationViewCards,
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
  const navigate = useNavigate();
  const activeDetailConnectionIdRef = useRef<string | null>(null);

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

  const connectedViewCards = buildConnectedIntegrationViewCards({
    connectedCards: connectedIntegrationCards,
    onOpenTarget: (targetKey) => {
      void navigate(`/integrations/${targetKey}`);
    },
  });

  const availableViewCards = buildAvailableIntegrationViewCards({
    cards,
    onOpenCreatePage: (targetKey) => {
      void navigate(`/integrations/${targetKey}/add`);
    },
  });

  return {
    availableViewCards,
    cards,
    connectedViewCards,
    integrationsQuery,
    activeDetailConnectionId,
    setActiveDetailConnectionId,
    onRefreshResource: resourceState.onRefreshResource,
    refreshingResourceKeys: resourceState.refreshingResourceKeys,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
