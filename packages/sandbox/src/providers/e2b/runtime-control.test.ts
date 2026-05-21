import { describe, expect, it } from "vitest";

import {
  SandboxdReadOperationLogTimeoutMs,
  SandboxdStopDaemonTimeoutMs,
} from "./runtime-control.js";

describe("E2B sandbox runtime control timeouts", () => {
  it("uses expanded diagnostic and daemon-stop timeouts during resume investigation", () => {
    expect(SandboxdReadOperationLogTimeoutMs).toBe(60_000);
    expect(SandboxdStopDaemonTimeoutMs).toBe(30_000);
  });
});
