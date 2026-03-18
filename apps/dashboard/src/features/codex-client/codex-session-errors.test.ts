import { describe, expect, it } from "vitest";

import {
  describeCodexSessionStepError,
  StaleConnectionAttemptError,
} from "./codex-session-errors.js";

describe("describeCodexSessionStepError", () => {
  it("preserves stale connection attempt errors", () => {
    const error = new StaleConnectionAttemptError();

    expect(describeCodexSessionStepError("Minting sandbox connection token", error)).toBe(error);
  });

  it("wraps regular errors with the step label", () => {
    expect(
      describeCodexSessionStepError(
        "Minting sandbox connection token",
        new Error("Network request failed."),
      ).message,
    ).toBe("Minting sandbox connection token failed: Network request failed.");
  });
});
