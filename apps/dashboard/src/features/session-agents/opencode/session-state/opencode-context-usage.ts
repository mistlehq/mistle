import type { OpenCodeProviderSummary } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";

import {
  formatKnownContextWindowRemaining,
  type ContextWindowRemainingViewModel,
} from "../../context-window-remaining.js";
import type { OpenCodeChatState } from "./opencode-chat-state.js";

export type OpenCodeContextUsageViewModel = ContextWindowRemainingViewModel;

type OpenCodeAssistantMessage = Extract<
  OpenCodeChatState["messagesById"][string]["info"],
  { role: "assistant" }
>;

export function formatOpenCodeContextUsage(input: {
  chatState: OpenCodeChatState;
  providers: readonly OpenCodeProviderSummary[];
}): OpenCodeContextUsageViewModel | null {
  const messages = input.chatState.messageOrder
    .map((messageId) => input.chatState.messagesById[messageId]?.info)
    .filter((message) => message !== undefined);
  const contextMessage = findLastAssistantMessageWithTokens(messages);

  if (contextMessage === null) {
    return null;
  }

  const totalTokens = getAssistantMessageTokenTotal(contextMessage);
  const contextWindow = findOpenCodeContextWindow({
    message: contextMessage,
    providers: input.providers,
  });

  if (contextWindow === null || contextWindow <= 0) {
    return null;
  }

  // Match upstream OpenCode: context usage is based on the assistant message's
  // total token count, including generated and cache tokens.
  const remainingPercent = Math.round(
    Math.min(Math.max(1 - totalTokens / contextWindow, 0), 1) * 100,
  );

  return formatKnownContextWindowRemaining({
    contextWindow,
    remainingPercent,
    usedTokens: totalTokens,
  });
}

function findLastAssistantMessageWithTokens(
  messages: readonly OpenCodeChatState["messagesById"][string]["info"][],
): OpenCodeAssistantMessage | null {
  let latestMessage: OpenCodeAssistantMessage | null = null;
  for (const message of messages) {
    if (message.role === "assistant" && getAssistantMessageTokenTotal(message) > 0) {
      latestMessage = message;
    }
  }

  return latestMessage;
}

function getAssistantMessageTokenTotal(message: OpenCodeAssistantMessage): number {
  return (
    message.tokens.input +
    message.tokens.output +
    message.tokens.reasoning +
    message.tokens.cache.read +
    message.tokens.cache.write
  );
}

function findOpenCodeContextWindow(input: {
  message: OpenCodeAssistantMessage;
  providers: readonly OpenCodeProviderSummary[];
}): number | null {
  const provider = input.providers.find((candidate) => candidate.id === input.message.providerID);
  return provider?.models[input.message.modelID]?.limit.context ?? null;
}
