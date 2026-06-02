import { describe, expect, it } from "vitest";

import { ActivateCommand } from "./client.js";
import {
  SandboxdReadOperationLogTimeoutMs as RuntimeControlSandboxdReadOperationLogTimeoutMs,
  SandboxdStopDaemonTimeoutMs as RuntimeControlSandboxdStopDaemonTimeoutMs,
} from "./runtime-control.js";

describe("E2B sandbox runtime control timeouts", () => {
  it("uses expanded diagnostic and daemon-stop timeouts during resume investigation", () => {
    expect(RuntimeControlSandboxdReadOperationLogTimeoutMs).toBe(60_000);
    expect(RuntimeControlSandboxdStopDaemonTimeoutMs).toBe(30_000);
  });
});

describe("E2B sandbox runtime control activate command", () => {
  it("invokes sandboxd activate", () => {
    expect(ActivateCommand).toBe("/opt/mistle/bin/sandboxd activate");
  });
});
