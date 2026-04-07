import { describe, expect, it } from "vitest";

import { resolveSandboxInstanceTitleCandidate } from "./seed-sandbox-instance-title.js";

describe("resolveSandboxInstanceTitleCandidate", () => {
  it("prefers the conversation name when present", () => {
    expect(
      resolveSandboxInstanceTitleCandidate({
        conversationName: "Issue triage thread",
        conversationPreview: "Fallback preview",
      }),
    ).toBe("Issue triage thread");
  });

  it("falls back to the preview when the name is blank", () => {
    expect(
      resolveSandboxInstanceTitleCandidate({
        conversationName: "   ",
        conversationPreview: "Investigate failing deployment",
      }),
    ).toBe("Investigate failing deployment");
  });

  it("returns null when neither candidate is usable", () => {
    expect(
      resolveSandboxInstanceTitleCandidate({
        conversationName: null,
        conversationPreview: "   ",
      }),
    ).toBeNull();
  });
});
