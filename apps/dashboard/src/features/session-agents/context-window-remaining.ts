const TokenCountFormatter = new Intl.NumberFormat("en-US");

export type ContextWindowRemainingViewModel = {
  label: string;
  title: string;
};

export function formatKnownContextWindowRemaining(input: {
  contextWindow: number;
  remainingPercent: number;
  usedTokens: number;
}): ContextWindowRemainingViewModel {
  const remainingPercent = Math.min(Math.max(Math.round(input.remainingPercent), 0), 100);
  return {
    label: `${String(remainingPercent)}% context left`,
    title: `${formatTokenCount(input.usedTokens)} tokens used of ${formatTokenCount(
      input.contextWindow,
    )} token context window.`,
  };
}

export function formatUnknownContextWindowRemaining(): ContextWindowRemainingViewModel {
  return {
    label: "Context left unknown",
    title: "Context window remaining is unknown until the next response reports token usage.",
  };
}

function formatTokenCount(value: number): string {
  return TokenCountFormatter.format(Math.max(Math.round(value), 0));
}
