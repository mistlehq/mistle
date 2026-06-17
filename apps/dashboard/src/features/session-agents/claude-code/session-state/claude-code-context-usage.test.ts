import { describe, expect, it } from "vitest";

import { formatClaudeCodeContextUsage } from "./claude-code-context-usage.js";

describe("formatClaudeCodeContextUsage", () => {
  it("formats known Claude Code context usage as remaining context", () => {
    expect(
      formatClaudeCodeContextUsage({
        tokens: 28000,
        contextWindow: 100000,
        percent: 28,
      }),
    ).toEqual({
      label: "72% context left",
      title: "28,000 tokens used of 100,000 token context window.",
    });
  });

  it("uses the shared unknown context label when Claude Code has no token count", () => {
    expect(
      formatClaudeCodeContextUsage({
        tokens: null,
        contextWindow: 100000,
        percent: null,
      }),
    ).toEqual({
      label: "Context left unknown",
      title: "Context window remaining is unknown until the next response reports token usage.",
    });
  });
});
