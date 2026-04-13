import { describe, expect, it } from "vitest";

import { formatPersistedFailureMessage } from "./format-persisted-failure-message.js";

describe("formatPersistedFailureMessage", () => {
  it("returns the summary when no useful detail is available", () => {
    expect(
      formatPersistedFailureMessage({
        summary: "Failed to initialize sandbox runtime.",
        error: new Error("Failed to initialize sandbox runtime."),
      }),
    ).toBe("Failed to initialize sandbox runtime.");
  });

  it("extracts structured sandboxd init errors from wrapped command output", () => {
    const commandExitError = new Error("exit status 1");
    const wrappedError = new Error(
      'E2B operation `init` failed: E2B sandbox init command exited with code 1. stdout: {"ok":false,"error":"failed to submit sandbox init request: control socket returned an error: failed to initialize sandboxd state: failed to apply startup input: runtime plan artifacts[2] lifecycle.install[0] failed (artifactKey=slack-cli): command failed with exit code 22 (output=curl: (22) The requested URL returned error: 403)"}',
      {
        cause: commandExitError,
      },
    );

    expect(
      formatPersistedFailureMessage({
        summary: "Failed to initialize sandbox runtime.",
        error: wrappedError,
      }),
    ).toBe(
      "Failed to initialize sandbox runtime.\n\nCause: failed to submit sandbox init request: control socket returned an error: failed to initialize sandboxd state: failed to apply startup input: runtime plan artifacts[2] lifecycle.install[0] failed (artifactKey=slack-cli): command failed with exit code 22 (output=curl: (22) The requested URL returned error: 403)",
    );
  });

  it("redacts bearer tokens in persisted detail", () => {
    expect(
      formatPersistedFailureMessage({
        summary: "Sandbox provider start failed before runtime provisioning completed.",
        error: new Error("Upstream request failed with Authorization: Bearer super-secret-token"),
      }),
    ).toBe(
      "Sandbox provider start failed before runtime provisioning completed.\n\nCause: Upstream request failed with Authorization: Bearer [REDACTED]",
    );
  });
});
