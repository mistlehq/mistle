export type ChatUserEntry = {
  id: string;
  turnId: string;
  kind: "user-message";
  text: string;
  status: "completed";
};

export type ChatAssistantEntry = {
  id: string;
  turnId: string;
  kind: "assistant-message";
  text: string;
  phase: string | null;
  status: "streaming" | "completed";
};

export type ChatCommandEntry = {
  id: string;
  turnId: string;
  kind: "command-execution";
  command: string | null;
  output: string | null;
  cwd: string | null;
  exitCode: number | null;
  commandStatus: string | null;
  reason: string | null;
  status: "streaming" | "completed";
};

export type ChatReasoningEntry = {
  id: string;
  turnId: string;
  kind: "reasoning";
  summary: string;
  source: "summary" | "content";
  status: "streaming" | "completed";
};

export type ChatPlanEntry = {
  id: string;
  turnId: string;
  kind: "plan";
  text: string;
  status: "streaming" | "completed";
};

export type ChatFileChangeEntry = {
  id: string;
  turnId: string;
  kind: "file-change";
  changes: readonly {
    path: string;
    kind: string | null;
    diff: string | null;
  }[];
  output: string | null;
  fileChangeStatus: string | null;
  status: "streaming" | "completed";
};

export type ChatGenericItemEntry = {
  id: string;
  turnId: string;
  kind: "generic-item";
  itemType: string;
  title: string;
  body: string | null;
  detailsJson: string | null;
  status: "streaming" | "completed";
};

export type ChatEntry =
  | ChatUserEntry
  | ChatAssistantEntry
  | ChatCommandEntry
  | ChatReasoningEntry
  | ChatPlanEntry
  | ChatFileChangeEntry
  | ChatGenericItemEntry;
