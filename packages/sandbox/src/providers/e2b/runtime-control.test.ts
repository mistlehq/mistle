import { describe, expect, it } from "vitest";

import { ActivateCommand, ShutdownCommand } from "./client.js";
import {
  SandboxdOperationLogPaths,
  SandboxdReadOperationLogTimeoutMs as RuntimeControlSandboxdReadOperationLogTimeoutMs,
  SandboxdStopDaemonTimeoutMs as RuntimeControlSandboxdStopDaemonTimeoutMs,
} from "./runtime-control.js";

describe("E2B sandbox runtime control timeouts", () => {
  it("uses expanded diagnostic and daemon-stop timeouts during resume investigation", () => {
    expect(RuntimeControlSandboxdReadOperationLogTimeoutMs).toBe(60_000);
    expect(RuntimeControlSandboxdStopDaemonTimeoutMs).toBe(30_000);
  });
});

describe("E2B sandbox runtime control operation logs", () => {
  it("can read activation and bootstrap tunnel diagnostics from sandboxd log files", () => {
    expect(SandboxdOperationLogPaths).toEqual({
      activate: "/run/mistle/activate.log",
      bootstrap_tunnel: "/run/mistle/bootstrap-tunnel.log",
    });
  });
});

describe("E2B sandbox runtime control activate command", () => {
  it("invokes sandboxd activate", () => {
    expect(ActivateCommand).toBe("/opt/mistle/bin/sandboxd activate");
  });
});

describe("E2B sandbox runtime control shutdown command", () => {
  it("invokes sandboxd shutdown", () => {
    expect(ShutdownCommand).toBe("/opt/mistle/bin/sandboxd shutdown");
  });
});
