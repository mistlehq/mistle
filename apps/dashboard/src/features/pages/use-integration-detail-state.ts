import { useMemo, useState } from "react";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";

export function useIntegrationDetailState(input: {
  cards: readonly IntegrationCardViewModel[];
  detailTargetKey: string | null;
}) {
  const [requestedDetailConnectionId, setRequestedDetailConnectionId] = useState<string | null>(
    null,
  );

  const selectedDetailCard = useMemo(() => {
    if (input.detailTargetKey === null) {
      return null;
    }

    return input.cards.find((card) => card.target.targetKey === input.detailTargetKey) ?? null;
  }, [input.cards, input.detailTargetKey]);

  const selectedDetailConnections = useMemo(() => {
    if (selectedDetailCard === null) {
      return [];
    }

    return selectedDetailCard.connections;
  }, [selectedDetailCard]);

  const defaultConnectionId = useMemo(() => {
    const defaultConnection =
      selectedDetailConnections.find((connection) => connection.status === "active") ??
      selectedDetailConnections[0] ??
      null;

    return defaultConnection?.id ?? null;
  }, [selectedDetailConnections]);

  const activeDetailConnectionId = useMemo(() => {
    if (defaultConnectionId === null) {
      return null;
    }

    if (
      requestedDetailConnectionId !== null &&
      selectedDetailConnections.some((connection) => connection.id === requestedDetailConnectionId)
    ) {
      return requestedDetailConnectionId;
    }

    return defaultConnectionId;
  }, [defaultConnectionId, requestedDetailConnectionId, selectedDetailConnections]);

  return {
    activeDetailConnectionId,
    setActiveDetailConnectionId: setRequestedDetailConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
