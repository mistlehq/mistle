import { describe, expect, it } from "vitest";

import {
  FreestyleSandboxdActivateTimeoutMs,
  FreestyleSandboxdReadOperationLogTimeoutMs,
  FreestyleSandboxdResetTransparentEgressNftablesTimeoutMs,
  FreestyleSandboxdStopDaemonTimeoutMs,
} from "./runtime-control.js";

describe("Freestyle sandbox runtime control timeouts", () => {
  it("uses bounded command timeouts for sandboxd maintenance operations", () => {
    expect(FreestyleSandboxdActivateTimeoutMs).toBe(60 * 60 * 1000);
    expect(FreestyleSandboxdStopDaemonTimeoutMs).toBe(30_000);
    expect(FreestyleSandboxdResetTransparentEgressNftablesTimeoutMs).toBe(10_000);
    expect(FreestyleSandboxdReadOperationLogTimeoutMs).toBe(60_000);
  });
});
