import { describe, expect, it } from "vitest";

import { isCodexThreadNotMaterializedError } from "./codex-thread-read-state.js";

describe("codex thread read state", () => {
  it("recognizes the unmaterialized thread includeTurns error", () => {
    expect(
      isCodexThreadNotMaterializedError(
        new Error(
          "JSON-RPC request 10 failed with code -32600: thread abc is not materialized yet; includeTurns is unavailable before first user message",
        ),
      ),
    ).toBe(true);
  });

  it("does not classify unrelated errors as unmaterialized thread errors", () => {
    expect(
      isCodexThreadNotMaterializedError(
        new Error("JSON-RPC request 10 failed with code -32603: internal server error"),
      ),
    ).toBe(false);
  });
});
