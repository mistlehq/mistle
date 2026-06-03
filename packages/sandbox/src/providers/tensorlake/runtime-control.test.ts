import { describe, expect, it } from "vitest";

import { ActivateCommandArgs, ShutdownCommandArgs } from "./client.js";
import {
  SandboxdResetTransparentEgressNftablesTimeoutMs,
  SandboxdReadOperationLogTimeoutMs,
  SandboxdStopDaemonTimeoutMs,
  createTensorlakeRootShellCommand,
} from "./runtime-control.js";

describe("Tensorlake sandbox runtime control timeouts", () => {
  it("uses expanded diagnostic and daemon-stop timeouts during resume investigation", () => {
    expect(SandboxdReadOperationLogTimeoutMs).toBe(60_000);
    expect(SandboxdStopDaemonTimeoutMs).toBe(30_000);
    expect(SandboxdResetTransparentEgressNftablesTimeoutMs).toBe(10_000);
  });
});

describe("Tensorlake sandbox runtime control activate command", () => {
  it("invokes sandboxd activate", () => {
    expect(ActivateCommandArgs).toEqual(["activate"]);
  });
});

describe("Tensorlake sandbox runtime control shutdown command", () => {
  it("invokes sandboxd shutdown", () => {
    expect(ShutdownCommandArgs).toEqual(["shutdown"]);
  });
});

describe("createTensorlakeRootShellCommand", () => {
  it("runs root shell scripts without sudo", () => {
    expect(createTensorlakeRootShellCommand({ script: "sandboxd install" })).toEqual({
      command: "sh",
      args: ["-euc", "sandboxd install"],
    });
  });
});
