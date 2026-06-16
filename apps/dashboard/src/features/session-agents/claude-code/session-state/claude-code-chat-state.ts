import type {
  ClaudeCodeSessionQuery,
  ClaudeCodeSessionReadResult,
} from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";

import type { ChatEntry } from "../../../chat/chat-types.js";

export type ClaudeCodeChatState = {
  completedErrorMessage: string | null;
  entries: readonly ChatEntry[];
  pendingQueryId: string | null;
  queries: readonly ClaudeCodeSessionQuery[];
  sessionId: string | null;
  status: "busy" | "failed" | "idle" | null;
};

export type ClaudeCodeChatAction =
  | {
      session: ClaudeCodeSessionReadResult["session"];
      type: "hydrate_session";
    }
  | {
      queryId: string;
      sessionId: string;
      submittedPrompt: string;
      type: "prompt_submitted";
    }
  | {
      errorMessage: string;
      type: "query_failed";
    };

export function createInitialClaudeCodeChatState(): ClaudeCodeChatState {
  return {
    completedErrorMessage: null,
    entries: [],
    pendingQueryId: null,
    queries: [],
    sessionId: null,
    status: null,
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

function readUserText(message: unknown): string {
  if (!isRecord(message) || readStringProperty(message, "type") !== "user") {
    return "";
  }
  return readStringProperty(message, "text") ?? "";
}

function buildEntriesFromSession(input: {
  activeQueryId: string | null;
  queries: readonly ClaudeCodeSessionQuery[];
  sessionId: string;
}): readonly ChatEntry[] {
  const entries: ChatEntry[] = [];
  input.queries.forEach((query, index) => {
    const userText = readUserText(query.message);
    if (userText.length > 0) {
      entries.push({
        id: `${input.sessionId}:user:${query.queryId}:${String(index)}`,
        kind: "user-message",
        status: "completed",
        text: userText,
        turnId: query.queryId,
      });
      return;
    }

    const text = readAssistantText(query.message);
    if (text.length === 0) {
      return;
    }

    entries.push({
      id: `${input.sessionId}:assistant:${String(index)}`,
      kind: "assistant-message",
      phase: null,
      status: input.activeQueryId === query.queryId ? "streaming" : "completed",
      text,
      turnId: query.queryId,
    });
  });
  return entries;
}

function appendSubmittedPromptEntry(input: {
  currentEntries: readonly ChatEntry[];
  queryId: string;
  sessionId: string;
  submittedPrompt: string;
}): readonly ChatEntry[] {
  return [
    ...input.currentEntries,
    {
      id: `${input.sessionId}:user:${input.queryId}`,
      kind: "user-message",
      status: "completed",
      text: input.submittedPrompt,
      turnId: input.queryId,
    },
  ];
}

export function reduceClaudeCodeChatState(
  state: ClaudeCodeChatState,
  action: ClaudeCodeChatAction,
): ClaudeCodeChatState {
  switch (action.type) {
    case "hydrate_session":
      return {
        completedErrorMessage: action.session.lastError,
        entries: buildEntriesFromSession({
          activeQueryId: action.session.activeQueryId,
          queries: action.session.queries,
          sessionId: action.session.id,
        }),
        pendingQueryId: action.session.activeQueryId,
        queries: action.session.queries,
        sessionId: action.session.id,
        status:
          action.session.status.type === "active"
            ? "busy"
            : action.session.lastError === null
              ? "idle"
              : "failed",
      };
    case "prompt_submitted":
      return {
        ...state,
        completedErrorMessage: null,
        entries: appendSubmittedPromptEntry({
          currentEntries: state.entries,
          queryId: action.queryId,
          sessionId: action.sessionId,
          submittedPrompt: action.submittedPrompt,
        }),
        pendingQueryId: action.queryId,
        sessionId: action.sessionId,
        status: "busy",
      };
    case "query_failed":
      return {
        ...state,
        completedErrorMessage: action.errorMessage,
        status: "failed",
      };
  }
}
