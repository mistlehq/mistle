import {
  formatKnownContextWindowRemaining,
  type ContextWindowRemainingViewModel,
} from "../../context-window-remaining.js";
import type { CodexThreadTokenUsageSnapshot } from "./codex-session-types.js";

const BaselineContextTokens = 12_000;
export type CodexContextUsageViewModel = ContextWindowRemainingViewModel;

export function formatCodexContextUsage(
  snapshot: CodexThreadTokenUsageSnapshot | null,
): CodexContextUsageViewModel | null {
  if (snapshot === null || snapshot.tokenUsage.modelContextWindow === null) {
    return null;
  }

  const contextWindow = snapshot.tokenUsage.modelContextWindow;
  if (contextWindow <= BaselineContextTokens) {
    return formatKnownContextWindowRemaining({
      contextWindow,
      remainingPercent: 0,
      usedTokens: snapshot.tokenUsage.last.totalTokens,
    });
  }

  const effectiveWindow = contextWindow - BaselineContextTokens;
  const usedContextTokens = Math.max(
    snapshot.tokenUsage.last.totalTokens - BaselineContextTokens,
    0,
  );
  const remainingContextTokens = Math.max(effectiveWindow - usedContextTokens, 0);
  const remainingPercent = Math.round(
    Math.min(Math.max(remainingContextTokens / effectiveWindow, 0), 1) * 100,
  );

  return formatKnownContextWindowRemaining({
    contextWindow,
    remainingPercent,
    usedTokens: snapshot.tokenUsage.last.totalTokens,
  });
}
