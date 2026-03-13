import { useEffect, useMemo, useState } from "react";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";

export function useIntegrationDetailState(input: {
  cards: readonly IntegrationCardViewModel[];
  detailTargetKey: string | null;
}) {
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);

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

  return {
    selectedConnectionId,
    setSelectedConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
