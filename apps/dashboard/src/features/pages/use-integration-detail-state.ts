import { useEffect, useMemo, useState } from "react";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";

export function useIntegrationDetailState(input: {
  cards: readonly IntegrationCardViewModel[];
  detailTargetKey: string | null;
}) {
  const [activeDetailConnectionId, setActiveDetailConnectionId] = useState<string | null>(null);

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

  useEffect(() => {
    const defaultConnection =
      selectedDetailConnections.find((connection) => connection.status === "active") ??
      selectedDetailConnections[0] ??
      null;
    if (defaultConnection === null) {
      setActiveDetailConnectionId(null);
      return;
    }

    const selectedStillExists = selectedDetailConnections.some(
      (connection) => connection.id === activeDetailConnectionId,
    );
    if (!selectedStillExists) {
      setActiveDetailConnectionId(defaultConnection.id);
    }
  }, [activeDetailConnectionId, selectedDetailConnections]);

  return {
    activeDetailConnectionId,
    setActiveDetailConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
