import { describe, expect, it } from "vitest";

import {
  ActivateCommand,
  DockerExecExitTimeoutMs,
  DockerLongRunningExecExitTimeoutMs,
  SandboxdResetTransparentEgressNftablesTimeoutMs,
  SandboxdStopDaemonTimeoutMs,
} from "./runtime-control.js";

describe("Docker sandbox runtime control timeouts", () => {
  it("keeps the generic exec wait timeout bounded", () => {
    expect(DockerExecExitTimeoutMs).toBe(120_000);
  });

  it("allows long-running sandboxd activation commands to run for one hour when requested", () => {
    expect(DockerLongRunningExecExitTimeoutMs).toBe(60 * 60 * 1000);
  });

  it("uses bounded daemon-stop and nftables-reset timeouts during sandboxd refresh", () => {
    expect(SandboxdStopDaemonTimeoutMs).toBe(30_000);
    expect(SandboxdResetTransparentEgressNftablesTimeoutMs).toBe(10_000);
  });
});

describe("Docker sandbox runtime control activate command", () => {
  it("invokes sandboxd activate", () => {
    expect(ActivateCommand).toEqual(["/opt/mistle/bin/sandboxd", "activate"]);
  });
});
