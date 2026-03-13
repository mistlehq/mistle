export type CodexItemStatus = "streaming" | "completed";

export type NormalizedFileChange = {
  path: string;
  kind: string | null;
  diff: string | null;
};

export type NormalizedCommandAction =
  | { type: "read"; command: string; name: string; path: string | null }
  | { type: "list-files"; command: string; path: string | null }
  | { type: "search"; command: string; query: string | null; path: string | null }
  | { type: "unknown"; command: string };

export type NormalizedCodexThreadItem =
  | {
      kind: "user-message";
      id: string;
      turnId: string;
      text: string;
    }
  | {
      kind: "assistant-message";
      id: string;
      turnId: string;
      text: string;
      phase: string | null;
      status: CodexItemStatus;
    }
  | {
      kind: "plan";
      id: string;
      turnId: string;
      text: string;
      status: CodexItemStatus;
    }
  | {
      kind: "reasoning";
      id: string;
      turnId: string;
      source: "summary" | "content";
      text: string;
      status: CodexItemStatus;
    }
  | {
      kind: "command-execution";
      id: string;
      turnId: string;
      command: string | null;
      cwd: string | null;
      commandStatus: string | null;
      exitCode: number | null;
      output: string | null;
      durationMs: number | null;
      commandActions: readonly NormalizedCommandAction[];
      reason: string | null;
      status: CodexItemStatus;
    }
  | {
      kind: "file-change";
      id: string;
      turnId: string;
      fileChangeStatus: string | null;
      changes: readonly NormalizedFileChange[];
      output: string | null;
      status: CodexItemStatus;
    }
  | {
      kind: "tool-call";
      id: string;
      turnId: string;
      toolType: "dynamic" | "mcp" | "collab";
      title: string;
      body: string | null;
      detailsJson: string | null;
      status: CodexItemStatus;
    }
  | {
      kind: "web-search";
      id: string;
      turnId: string;
      query: string | null;
      detailsJson: string | null;
      status: CodexItemStatus;
    }
  | {
      kind: "generic-item";
      id: string;
      turnId: string;
      itemType: string;
      title: string;
      body: string | null;
      detailsJson: string | null;
      status: CodexItemStatus;
    };

export type SemanticDisplayKey =
  | "exploring.active"
  | "exploring.done"
  | "running-commands.active"
  | "running-commands.done"
  | "making-edits.active"
  | "making-edits.done"
  | "thinking.active"
  | "thinking.done"
  | "searching-web.active"
  | "searching-web.done"
  | "tool-call.active"
  | "tool-call.done"
  | "generic.active";

export type SemanticActionKind =
  | "exploring"
  | "running-commands"
  | "making-edits"
  | "thinking"
  | "searching-web"
  | "tool-call"
  | "generic";

export type GroupableSemanticActionKind = Exclude<SemanticActionKind, "generic">;

export type ClassifiedCodexThreadItem = {
  item: NormalizedCodexThreadItem;
  semanticKind: SemanticActionKind;
  displayKeys: {
    active: SemanticDisplayKey | null;
    completed: SemanticDisplayKey | null;
  };
  status: CodexItemStatus;
  summaryCounts: {
    reads: number;
    searches: number;
    lists: number;
  } | null;
};

export type SemanticActionGroup = {
  id: string;
  kind: GroupableSemanticActionKind;
  status: CodexItemStatus;
  displayKeys: {
    active: SemanticDisplayKey | null;
    completed: SemanticDisplayKey | null;
  };
  counts: {
    reads: number;
    searches: number;
    lists: number;
  } | null;
  items: readonly NormalizedCodexThreadItem[];
};

export type StandaloneTimelineEntry = {
  id: string;
  item: NormalizedCodexThreadItem;
  semanticKind: SemanticActionKind;
  status: CodexItemStatus;
  displayKeys: {
    active: SemanticDisplayKey | null;
    completed: SemanticDisplayKey | null;
  };
};

export type CodexTimelineEntry = SemanticActionGroup | StandaloneTimelineEntry;
