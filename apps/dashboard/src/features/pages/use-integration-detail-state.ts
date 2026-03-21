import { useRef, useState } from "react";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";

export function useIntegrationDetailState(input: {
  cards: readonly IntegrationCardViewModel[];
  detailTargetKey: string | null;
}) {
  const invalidatedRequestedConnectionIdsRef = useRef<Set<string>>(new Set());
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

  const requestedConnectionStillExists =
    requestedDetailConnectionId !== null &&
    selectedDetailConnections.some((connection) => connection.id === requestedDetailConnectionId);
  if (!requestedConnectionStillExists && requestedDetailConnectionId !== null) {
    invalidatedRequestedConnectionIdsRef.current.add(requestedDetailConnectionId);
  }
  const requestedConnectionIsInvalidated =
    requestedDetailConnectionId !== null &&
    invalidatedRequestedConnectionIdsRef.current.has(requestedDetailConnectionId);

  const activeDetailConnectionId =
    defaultConnectionId !== null &&
    requestedConnectionStillExists &&
    !requestedConnectionIsInvalidated
      ? requestedDetailConnectionId
      : defaultConnectionId;

  return {
    activeDetailConnectionId,
    setActiveDetailConnectionId: (nextConnectionId: string | null) => {
      if (nextConnectionId !== null) {
        invalidatedRequestedConnectionIdsRef.current.delete(nextConnectionId);
      }

      setRequestedDetailConnectionId(nextConnectionId);
    },
    selectedDetailCard,
    selectedDetailConnections,
  };
}
