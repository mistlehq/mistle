import { describe, expect, it } from "vitest";

import { assertDesignerSubmitActionTargetsSupportedDraft } from "./use-codex-session-state.js";

describe("assertDesignerSubmitActionTargetsSupportedDraft", () => {
  it("accepts the sandbox profile draft targeted by the trusted dashboard session context", () => {
    expect(() =>
      assertDesignerSubmitActionTargetsSupportedDraft({
        submitActionTargetDraft: {
          profileId: "sbp_designer",
          version: 2,
        },
        supportedTargetDraft: {
          profileId: "sbp_designer",
          version: 2,
        },
      }),
    ).not.toThrow();
  });

  it("rejects sandbox-originated submit actions that target a different draft", () => {
    expect(() =>
      assertDesignerSubmitActionTargetsSupportedDraft({
        submitActionTargetDraft: {
          profileId: "sbp_victim",
          version: 1,
        },
        supportedTargetDraft: {
          profileId: "sbp_designer",
          version: 1,
        },
      }),
    ).toThrow("Sandbox profile draft provider resource save target is not allowed.");
  });

  it("rejects sandbox-originated submit actions that target a different draft version", () => {
    expect(() =>
      assertDesignerSubmitActionTargetsSupportedDraft({
        submitActionTargetDraft: {
          profileId: "sbp_designer",
          version: 2,
        },
        supportedTargetDraft: {
          profileId: "sbp_designer",
          version: 1,
        },
      }),
    ).toThrow("Sandbox profile draft provider resource save target is not allowed.");
  });
});
