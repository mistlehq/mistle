export type BootstrapConnectionContext = {
  connectionKey: string;
  activeThreadId: string;
};

export type BootstrapConnectionCandidate = {
  sandboxInstanceId: string;
  connectedAtIso: string;
  activeThreadId: string | null;
};

export type SessionBootstrapPlan = {
  connectionKey: string | null;
  shouldLoadBootstrapData: boolean;
  threadSyncKey: string | null;
};

function createConnectionKey(candidate: BootstrapConnectionCandidate): string {
  return `${candidate.sandboxInstanceId}:${candidate.connectedAtIso}`;
}

export function resolveBootstrapConnectionContext(input: {
  connectionCandidate: BootstrapConnectionCandidate | null;
}): BootstrapConnectionContext | null {
  if (input.connectionCandidate === null || input.connectionCandidate.activeThreadId === null) {
    return null;
  }

  return {
    connectionKey: createConnectionKey(input.connectionCandidate),
    activeThreadId: input.connectionCandidate.activeThreadId,
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
    threadSyncKey: `${connectionKey}:${input.bootstrapConnectionContext.activeThreadId}`,
  };
}
