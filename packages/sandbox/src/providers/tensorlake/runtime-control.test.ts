import { describe, expect, it } from "vitest";

import {
  SandboxdReadOperationLogTimeoutMs,
  SandboxdStopDaemonTimeoutMs,
  createTensorlakeRootShellCommand,
} from "./runtime-control.js";

describe("Tensorlake sandbox runtime control timeouts", () => {
  it("uses expanded diagnostic and daemon-stop timeouts during resume investigation", () => {
    expect(SandboxdReadOperationLogTimeoutMs).toBe(60_000);
    expect(SandboxdStopDaemonTimeoutMs).toBe(30_000);
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
