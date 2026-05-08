export type StartSessionStep = "idle" | "securing" | "connecting" | "connected";

export type ConnectedCodexSession = {
  sandboxInstanceId: string;
  connectedAtIso: string;
  providerThreadId: string | null;
  activeThreadId: string | null;
  activeThreadCwd: string | null;
};

export type CodexThreadLifecycleEvent = {
  method: "thread/status/changed" | "thread/closed" | "thread/archived" | "thread/unarchived";
  threadId: string;
  statusJson: string | null;
};

export type CodexThreadTokenUsageSnapshot = {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: CodexTokenUsageBreakdown;
    last: CodexTokenUsageBreakdown;
    modelContextWindow: number | null;
  };
};

export type CodexTokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type CodexThreadNameUpdate = {
  threadId: string;
  title: string;
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
