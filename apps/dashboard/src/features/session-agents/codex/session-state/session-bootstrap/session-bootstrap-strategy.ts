import type { ConnectedCodexSession } from "../codex-session-types.js";

export type BootstrapConnectionContext = {
  connectionKey: string;
  threadId: string;
};

export type SessionBootstrapPlan = {
  connectionKey: string | null;
  shouldLoadBootstrapData: boolean;
  threadSyncKey: string | null;
};

function createConnectionKey(connectedSession: ConnectedCodexSession): string {
  return `${connectedSession.sandboxInstanceId}:${connectedSession.connectedAtIso}`;
}

export function resolveBootstrapConnectionContext(input: {
  connectedSession: ConnectedCodexSession | null;
}): BootstrapConnectionContext | null {
  if (input.connectedSession === null || input.connectedSession.threadId === null) {
    return null;
  }

  return {
    connectionKey: createConnectionKey(input.connectedSession),
    threadId: input.connectedSession.threadId,
  };
}

export function resolveSessionBootstrapPlan(input: {
  bootstrapConnectionContext: BootstrapConnectionContext | null;
  establishedConnectionKey: string | null;
}): SessionBootstrapPlan {
  if (input.bootstrapConnectionContext === null) {
    return {
      connectionKey: null,
      shouldLoadBootstrapData: false,
      threadSyncKey: null,
    };
  }

  const connectionKey = input.bootstrapConnectionContext.connectionKey;

  return {
    connectionKey,
    shouldLoadBootstrapData: input.establishedConnectionKey !== connectionKey,
    threadSyncKey: `${connectionKey}:${input.bootstrapConnectionContext.threadId}`,
  };
}
