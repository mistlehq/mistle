import { describe, expect, it } from "vitest";

import { isRecoverableLateSteerError, isStaleActiveTurnMismatchError } from "./provider-errors.js";

describe("provider errors", () => {
  describe("isRecoverableLateSteerError", () => {
    it("recognizes the no-active-turn steer race as recoverable", () => {
      expect(
        isRecoverableLateSteerError({
          error: {
            code: "provider_execution_missing",
            message:
              "Codex app-server request 'turn/steer' failed (-32600): no active turn to steer",
          },
        }),
      ).toBe(true);
    });

    it("does not recover expected-turn mismatches as idle turns", () => {
      expect(
        isRecoverableLateSteerError({
          error: {
            code: "provider_execution_missing",
            message:
              "Codex app-server request 'turn/steer' failed (-32600): expected active turn id `turn_expected` but found `turn_actual`",
          },
        }),
      ).toBe(false);
    });

    it("does not recover unrelated provider errors", () => {
      expect(
        isRecoverableLateSteerError({
          error: {
            code: "provider_steer_execution_failed",
            message: "Codex steer execution failed.",
          },
        }),
      ).toBe(false);
    });
  });

  describe("isStaleActiveTurnMismatchError", () => {
    it("recognizes stale expected-turn mismatches separately", () => {
      expect(
        isStaleActiveTurnMismatchError({
          error: {
            code: "provider_execution_missing",
            message:
              "Codex app-server request 'turn/steer' failed (-32600): expected active turn id `turn_expected` but found `turn_actual`",
          },
        }),
      ).toBe(true);
    });
  });
});
