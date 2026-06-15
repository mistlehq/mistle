import { describe, expect, it } from "vitest";

import { formatPiContextUsage } from "./pi-context-usage.js";

describe("formatPiContextUsage", () => {
  it("formats Pi context usage as context window remaining", () => {
    expect(
      formatPiContextUsage({
        tokens: 40_000,
        contextWindow: 100_000,
        percent: 40,
      }),
    ).toEqual({
      label: "60% context left",
      title: "40,000 tokens used of 100,000 token context window.",
    });
  });

  it("preserves Pi's unknown post-compaction context usage state", () => {
    expect(
      formatPiContextUsage({
        tokens: null,
        contextWindow: 100_000,
        percent: null,
      }),
    ).toEqual({
      label: "Context left unknown",
      title: "Context window remaining is unknown until the next response reports token usage.",
    });
  });

  it("omits context window remaining when Pi has no context window", () => {
    expect(
      formatPiContextUsage({
        tokens: 40_000,
        contextWindow: 0,
        percent: 40,
      }),
    ).toBeNull();
  });
});
