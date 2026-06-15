import type { PiContextUsage } from "@mistle/integrations-definitions/agent-runtimes/pi/client";

import {
  formatKnownContextWindowRemaining,
  formatUnknownContextWindowRemaining,
  type ContextWindowRemainingViewModel,
} from "../../context-window-remaining.js";

export type PiContextUsageViewModel = ContextWindowRemainingViewModel;

export function formatPiContextUsage(
  contextUsage: PiContextUsage | null | undefined,
): PiContextUsageViewModel | null {
  if (contextUsage === null || contextUsage === undefined || contextUsage.contextWindow <= 0) {
    return null;
  }

  if (contextUsage.percent === null || contextUsage.tokens === null) {
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
