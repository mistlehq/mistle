import { useEffect, useRef, useState } from "react";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";

export function useIntegrationDetailState(input: {
  cards: readonly IntegrationCardViewModel[];
  detailConnectionId: string | null;
  detailTargetKey: string | null;
}) {
  const invalidatedUserRequestedConnectionIdsRef = useRef<Set<string>>(new Set());
  const lastRouteConnectionIdRef = useRef<string | null>(input.detailConnectionId);
  const [requestedDetailConnection, setRequestedDetailConnection] = useState<{
    id: string | null;
    source: "route" | "user";
  }>(() => ({
    id: input.detailConnectionId,
    source: "route",
  }));

  useEffect(() => {
    if (input.detailConnectionId === lastRouteConnectionIdRef.current) {
      return;
    }

    lastRouteConnectionIdRef.current = input.detailConnectionId;
    setRequestedDetailConnection({
      id: input.detailConnectionId,
      source: "route",
    });
  }, [input.detailConnectionId]);

  const selectedDetailCard =
    input.detailTargetKey === null
      ? null
      : (input.cards.find((card) => card.target.targetKey === input.detailTargetKey) ?? null);

  const selectedDetailConnections = selectedDetailCard?.connections ?? [];

  const defaultConnectionId =
    selectedDetailConnections.find((connection) => connection.status === "active")?.id ??
    selectedDetailConnections[0]?.id ??
    null;
  const requestedDetailConnectionId = requestedDetailConnection.id;

  const requestedConnectionStillExists =
    requestedDetailConnectionId !== null &&
    selectedDetailConnections.some((connection) => connection.id === requestedDetailConnectionId);
  if (
    requestedDetailConnection.source === "user" &&
    !requestedConnectionStillExists &&
    requestedDetailConnectionId !== null
  ) {
    invalidatedUserRequestedConnectionIdsRef.current.add(requestedDetailConnectionId);
  }
  const requestedConnectionIsInvalidated =
    requestedDetailConnectionId !== null &&
    invalidatedUserRequestedConnectionIdsRef.current.has(requestedDetailConnectionId);

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
        invalidatedUserRequestedConnectionIdsRef.current.delete(nextConnectionId);
      }

      setRequestedDetailConnection({
        id: nextConnectionId,
        source: "user",
      });
    },
    selectedDetailCard,
    selectedDetailConnections,
  };
}
