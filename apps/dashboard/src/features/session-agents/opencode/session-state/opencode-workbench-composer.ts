import type { ChatState } from "../../../chat/chat-state.js";
import type { SessionComposerBootstrapResult } from "../../../pages/session-composer/session-composer-runtime-contracts.js";
import type { OpenCodeChatState } from "./opencode-chat-state.js";
import {
  parseOpenCodePromptModelSelection,
  type OpenCodePromptModelSelection,
} from "./use-opencode-session-state.js";

type OpenCodeConversationChatState = Pick<
  ChatState,
  "activeTurnId" | "entries" | "pendingTurnId" | "status"
>;

export function resolveOpenCodePromptModelOverride(
  hasExplicitModelSelection: boolean,
  selectedModel: string | null,
): OpenCodePromptModelSelection | undefined {
  if (!hasExplicitModelSelection || selectedModel === null) {
    return undefined;
  }

  return parseOpenCodePromptModelSelection(selectedModel);
}

export function buildOpenCodeComposerConfigResetKey(
  sandboxInstanceId: string | null,
  sessionId: string | null,
): string {
  return `${sandboxInstanceId ?? ""}:${sessionId ?? ""}`;
}

export function mapOpenCodeChatStateForConversation(
  chatState: OpenCodeChatState,
): OpenCodeConversationChatState {
  const activeTurnId =
    chatState.status === "busy" ? (chatState.sessionId ?? "opencode-active-turn") : null;

  return {
    activeTurnId,
    entries: chatState.entries,
    pendingTurnId: null,
    status: chatState.status === "busy" ? "inProgress" : chatState.status,
  };
}

export function buildRefreshingOpenCodeComposerBootstrap(): SessionComposerBootstrapResult {
  return {
    phase: { status: "bootstrapping" },
    establishedSnapshot: {
      availableModels: [],
      configSnapshot: {
        model: null,
        modelReasoningEffort: null,
      },
    },
  };
}
