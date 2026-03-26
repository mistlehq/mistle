export type StartSessionStep = "idle" | "securing" | "connecting" | "connected";

export type ConnectedCodexSession = {
  sandboxInstanceId: string;
  connectedAtIso: string;
  expiresAtIso: string;
  connectionUrl: string;
  threadId: string | null;
};

export type CodexThreadLifecycleEvent = {
  method: "thread/status/changed" | "thread/closed" | "thread/archived" | "thread/unarchived";
  threadId: string;
  statusJson: string | null;
};

export type CodexThreadTokenUsageSnapshot = {
  threadId: string;
  usageJson: string;
};

export type CodexTurnDiffSnapshot = {
  threadId: string | null;
  turnId: string;
  diff: string;
};

export type CodexTurnPlanSnapshot = {
  turnId: string;
  explanation: string | null;
  steps: readonly {
    step: string;
    status: string;
  }[];
};
