import type { ConnectedCodexSession } from "../codex-session-types.js";

export type SessionBootstrapPlan = {
  connectionKey: string | null;
  shouldLoadBootstrapData: boolean;
  threadSyncKey: string | null;
};

function createConnectionKey(connectedSession: ConnectedCodexSession): string {
  return `${connectedSession.sandboxInstanceId}:${connectedSession.connectedAtIso}`;
}

export function resolveSessionBootstrapPlan(input: {
  connectedSession: ConnectedCodexSession | null;
  establishedConnectionKey: string | null;
}): SessionBootstrapPlan {
  if (input.connectedSession === null || input.connectedSession.threadId === null) {
    return {
      connectionKey: null,
      shouldLoadBootstrapData: false,
      threadSyncKey: null,
    };
  }

  const connectionKey = createConnectionKey(input.connectedSession);

  return {
    connectionKey,
    shouldLoadBootstrapData: input.establishedConnectionKey !== connectionKey,
    threadSyncKey: `${connectionKey}:${input.connectedSession.threadId}`,
  };
}
