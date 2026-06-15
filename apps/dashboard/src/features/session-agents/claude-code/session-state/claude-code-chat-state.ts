import type {
  ClaudeCodeThreadReadResult,
  ClaudeCodeThreadTurn,
} from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";

import type { ChatEntry } from "../../../chat/chat-types.js";

export type ClaudeCodeChatState = {
  completedErrorMessage: string | null;
  entries: readonly ChatEntry[];
  pendingTurnId: string | null;
  status: "busy" | "failed" | "idle" | null;
  threadId: string | null;
  turns: readonly ClaudeCodeThreadTurn[];
};

export type ClaudeCodeChatAction =
  | {
      thread: ClaudeCodeThreadReadResult["thread"];
      type: "hydrate_thread";
    }
  | {
      submittedPrompt: string;
      threadId: string;
      turnId: string;
      type: "prompt_submitted";
    }
  | {
      errorMessage: string;
      type: "turn_failed";
    };

export function createInitialClaudeCodeChatState(): ClaudeCodeChatState {
  return {
    completedErrorMessage: null,
    entries: [],
    pendingTurnId: null,
    status: null,
    threadId: null,
    turns: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringProperty(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readAssistantText(message: unknown): string {
  if (!isRecord(message) || readStringProperty(message, "type") !== "assistant") {
    return "";
  }
  const rawMessage = message["message"];
  if (!isRecord(rawMessage)) {
    return "";
  }
  const content = rawMessage["content"];
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((part) => {
      if (!isRecord(part) || readStringProperty(part, "type") !== "text") {
        return [];
      }
      return [readStringProperty(part, "text") ?? ""];
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function buildEntriesFromThread(input: {
  activeTurnId: string | null;
  threadId: string;
  turns: readonly ClaudeCodeThreadTurn[];
}): readonly ChatEntry[] {
  return input.turns.flatMap((turn, index) => {
    const text = readAssistantText(turn.message);
    if (text.length === 0) {
      return [];
    }

    return [
      {
        id: `${input.threadId}:assistant:${String(index)}`,
        kind: "assistant-message" as const,
        phase: null,
        status:
          input.activeTurnId === turn.executionId ? ("streaming" as const) : ("completed" as const),
        text,
        turnId: turn.executionId,
      },
    ];
  });
}

function appendSubmittedPromptEntry(input: {
  currentEntries: readonly ChatEntry[];
  submittedPrompt: string;
  threadId: string;
  turnId: string;
}): readonly ChatEntry[] {
  return [
    ...input.currentEntries,
    {
      id: `${input.threadId}:user:${input.turnId}`,
      kind: "user-message",
      status: "completed",
      text: input.submittedPrompt,
      turnId: input.turnId,
    },
  ];
}

export function reduceClaudeCodeChatState(
  state: ClaudeCodeChatState,
  action: ClaudeCodeChatAction,
): ClaudeCodeChatState {
  switch (action.type) {
    case "hydrate_thread":
      return {
        completedErrorMessage: action.thread.lastError,
        entries: buildEntriesFromThread({
          activeTurnId: action.thread.activeTurnId,
          threadId: action.thread.id,
          turns: action.thread.turns,
        }),
        pendingTurnId: action.thread.activeTurnId,
        status:
          action.thread.status.type === "active"
            ? "busy"
            : action.thread.lastError === null
              ? "idle"
              : "failed",
        threadId: action.thread.id,
        turns: action.thread.turns,
      };
    case "prompt_submitted":
      return {
        ...state,
        completedErrorMessage: null,
        entries: appendSubmittedPromptEntry({
          currentEntries: state.entries,
          submittedPrompt: action.submittedPrompt,
          threadId: action.threadId,
          turnId: action.turnId,
        }),
        pendingTurnId: action.turnId,
        status: "busy",
        threadId: action.threadId,
      };
    case "turn_failed":
      return {
        ...state,
        completedErrorMessage: action.errorMessage,
        status: "failed",
      };
  }
}
