import type { ClaudeCodeContextUsage } from "@mistle/integrations-definitions/agent-runtimes/claude-code/client";

import {
  formatKnownContextWindowRemaining,
  formatUnknownContextWindowRemaining,
  type ContextWindowRemainingViewModel,
} from "../../context-window-remaining.js";

export type ClaudeCodeContextUsageViewModel = ContextWindowRemainingViewModel;

export function formatClaudeCodeContextUsage(
  contextUsage: ClaudeCodeContextUsage | null | undefined,
): ClaudeCodeContextUsageViewModel | null {
  if (contextUsage === null || contextUsage === undefined || contextUsage.contextWindow <= 0) {
    return null;
  }

  if (contextUsage.tokens === null) {
    return formatUnknownContextWindowRemaining();
  }

  const remainingPercent = Math.round(
    Math.min(Math.max(1 - contextUsage.tokens / contextUsage.contextWindow, 0), 1) * 100,
  );

  return formatKnownContextWindowRemaining({
    contextWindow: contextUsage.contextWindow,
    remainingPercent,
    usedTokens: contextUsage.tokens,
  });
}
