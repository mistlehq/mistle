import { useEffect, useState } from "react";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";

export function useIntegrationDetailState(input: {
  cards: readonly IntegrationCardViewModel[];
  detailTargetKey: string | null;
}) {
  const [requestedDetailConnectionId, setRequestedDetailConnectionId] = useState<string | null>(
    null,
  );

  const selectedDetailCard =
    input.detailTargetKey === null
      ? null
      : (input.cards.find((card) => card.target.targetKey === input.detailTargetKey) ?? null);

  const selectedDetailConnections = selectedDetailCard?.connections ?? [];

  const defaultConnectionId =
    selectedDetailConnections.find((connection) => connection.status === "active")?.id ??
    selectedDetailConnections[0]?.id ??
    null;

  useEffect(() => {
    if (requestedDetailConnectionId === null) {
      return;
    }

    const requestedConnectionStillExists = selectedDetailConnections.some(
      (connection) => connection.id === requestedDetailConnectionId,
    );
    if (requestedConnectionStillExists) {
      return;
    }

    setRequestedDetailConnectionId(null);
  }, [requestedDetailConnectionId, selectedDetailConnections]);

  const activeDetailConnectionId =
    defaultConnectionId !== null &&
    requestedDetailConnectionId !== null &&
    selectedDetailConnections.some((connection) => connection.id === requestedDetailConnectionId)
      ? requestedDetailConnectionId
      : defaultConnectionId;

  return {
    activeDetailConnectionId,
    setActiveDetailConnectionId: setRequestedDetailConnectionId,
    selectedDetailCard,
    selectedDetailConnections,
  };
}
