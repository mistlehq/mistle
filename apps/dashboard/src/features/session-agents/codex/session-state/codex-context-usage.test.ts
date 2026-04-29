import { describe, expect, it } from "vitest";

import { formatCodexContextUsage } from "./codex-context-usage.js";
import type { CodexThreadTokenUsageSnapshot } from "./codex-session-types.js";

function createTokenUsageSnapshot(input: {
  lastTotalTokens: number;
  modelContextWindow: number | null;
}): CodexThreadTokenUsageSnapshot {
  return {
    threadId: "thread_123",
    turnId: "turn_123",
    tokenUsage: {
      total: createTokenUsageBreakdown(input.lastTotalTokens),
      last: createTokenUsageBreakdown(input.lastTotalTokens),
      modelContextWindow: input.modelContextWindow,
    },
  };
}

function createTokenUsageBreakdown(
  totalTokens: number,
): CodexThreadTokenUsageSnapshot["tokenUsage"]["last"] {
  return {
    totalTokens,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

describe("formatCodexContextUsage", () => {
  it("formats remaining context using the normalized context window", () => {
    expect(
      formatCodexContextUsage(
        createTokenUsageSnapshot({
          lastTotalTokens: 106_000,
          modelContextWindow: 200_000,
        }),
      ),
    ).toEqual({
      label: "Context 50% left",
      title: "106,000 used of 200,000 window",
    });
  });

  it("does not render a left-context label without a model context window", () => {
    expect(
      formatCodexContextUsage(
        createTokenUsageSnapshot({
          lastTotalTokens: 106_000,
          modelContextWindow: null,
        }),
      ),
    ).toBeNull();
  });
});
