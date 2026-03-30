import { describe, expect, it } from "vitest";

import { StaleConnectionAttemptError } from "../session-connection/codex-session-errors.js";
import { ensureCurrentThreadSyncGeneration } from "./use-session-bootstrap.js";

describe("ensureCurrentThreadSyncGeneration", () => {
  it("allows the active thread sync generation to continue", () => {
    expect(() => {
      ensureCurrentThreadSyncGeneration({
        currentGeneration: 3,
        expectedGeneration: 3,
      });
    }).not.toThrow();
  });

  it("throws a stale connection attempt error when the thread sync generation is outdated", () => {
    expect(() => {
      ensureCurrentThreadSyncGeneration({
        currentGeneration: 4,
        expectedGeneration: 3,
      });
    }).toThrow(StaleConnectionAttemptError);
  });
});
