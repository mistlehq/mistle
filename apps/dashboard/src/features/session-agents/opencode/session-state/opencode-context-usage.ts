import type { OpenCodeProviderSummary } from "@mistle/integrations-definitions/agent-runtimes/opencode/client";

import type { OpenCodeChatState } from "./opencode-chat-state.js";

const TokenCountFormatter = new Intl.NumberFormat("en-US");
const UsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export type OpenCodeContextUsageViewModel = {
  label: string;
  title: string;
};

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
  const totalCost = messages.reduce(
    (sum, message) => sum + (message.role === "assistant" ? message.cost : 0),
    0,
  );
  const contextMessage = findLastAssistantMessageWithTokens(messages);

  if (contextMessage === null) {
    return totalCost > 0
      ? {
          label: `Cost ${formatCost(totalCost)}`,
          title: `${formatCost(totalCost)} total cost`,
        }
      : null;
  }

  const totalTokens = getAssistantMessageTokenTotal(contextMessage);
  const contextWindow = findOpenCodeContextWindow({
    message: contextMessage,
    providers: input.providers,
  });
  const costTitle = `${formatCost(totalCost)} total cost`;

  if (contextWindow === null || contextWindow <= 0) {
    return {
      label: `Context ${formatTokenCount(totalTokens)} tokens`,
      title: `${formatTokenCount(totalTokens)} tokens used, ${costTitle}`,
    };
  }

  // Match upstream OpenCode: context usage is based on the assistant message's
  // total token count, including generated and cache tokens.
  const usagePercent = Math.round(Math.max(totalTokens / contextWindow, 0) * 100);

  return {
    label: `Context ${String(usagePercent)}% used`,
    title: `${formatTokenCount(totalTokens)} used of ${formatTokenCount(
      contextWindow,
    )} window, ${costTitle}`,
  };
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

function formatTokenCount(value: number): string {
  return TokenCountFormatter.format(Math.max(Math.round(value), 0));
}

function formatCost(value: number): string {
  return UsdFormatter.format(Math.max(value, 0));
}
