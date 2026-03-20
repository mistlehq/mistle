import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { useNavigate } from "react-router";

import { buildIntegrationCards } from "../integrations/directory-model.js";
import { listIntegrationDirectory } from "../integrations/integrations-service.js";
import type { OpenIntegrationConnectionDialogInput } from "./integration-connection-dialog-state-types.js";
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
  onOpenCreateDialog: (input: OpenIntegrationConnectionDialogInput) => void;
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

  const { activeDetailConnectionId, selectedDetailCard, selectedDetailConnections } =
    useIntegrationDetailState({
      cards,
      detailTargetKey: input.detailTargetKey,
    });
  activeDetailConnectionIdRef.current = activeDetailConnectionId;

  const resourceState = useIntegrationResourceState({
    detailConnections: selectedDetailConnections,
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
  });

  const connectedViewCards = buildConnectedIntegrationViewCards({
    connectedCards: connectedIntegrationCards,
    onOpenTarget: (targetKey) => {
      void navigate(`/settings/organization/integrations/${targetKey}`);
    },
  });

  const availableViewCards = buildAvailableIntegrationViewCards({
    cards,
    onOpenCreateDialog: input.onOpenCreateDialog,
  });

  return {
    availableViewCards,
    cards,
    connectedViewCards,
    integrationsQuery,
    onRefreshResource: resourceState.onRefreshResource,
    refreshingResourceKeys: resourceState.refreshingResourceKeys,
    resourceItemsByKey: resourceState.resourceItemsByKey,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
