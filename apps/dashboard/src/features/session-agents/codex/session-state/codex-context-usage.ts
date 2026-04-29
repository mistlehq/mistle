import type { CodexThreadTokenUsageSnapshot } from "./codex-session-types.js";

const BaselineContextTokens = 12_000;
const TokenCountFormatter = new Intl.NumberFormat("en-US");

export type CodexContextUsageViewModel = {
  label: string;
  title: string;
};

export function formatCodexContextUsage(
  snapshot: CodexThreadTokenUsageSnapshot | null,
): CodexContextUsageViewModel | null {
  if (snapshot === null || snapshot.tokenUsage.modelContextWindow === null) {
    return null;
  }

  const contextWindow = snapshot.tokenUsage.modelContextWindow;
  if (contextWindow <= BaselineContextTokens) {
    return {
      label: "Context 0% left",
      title: `${formatTokenCount(snapshot.tokenUsage.last.totalTokens)} used of ${formatTokenCount(
        contextWindow,
      )} window`,
    };
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

  return {
    label: `Context ${String(remainingPercent)}% left`,
    title: `${formatTokenCount(snapshot.tokenUsage.last.totalTokens)} used of ${formatTokenCount(
      contextWindow,
    )} window`,
  };
}

function formatTokenCount(value: number): string {
  return TokenCountFormatter.format(Math.max(Math.round(value), 0));
}
