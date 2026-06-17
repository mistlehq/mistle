import { describe, expect, it } from "vitest";

import {
  type CommandProbeResult,
  createAgentBootstrapDoctorReport,
  readExpectedPnpmVersionFromPackageJsonValue,
} from "./agent-bootstrap-doctor.js";

const ExpectedPnpmVersion = "11.4.0";

describe("createAgentBootstrapDoctorReport", () => {
  it("recommends direct commands when bare pnpm reaches the expected version", () => {
    const report = createAgentBootstrapDoctorReport({
      directPnpm: successfulProbe(["pnpm", "--version"], ExpectedPnpmVersion),
      expectedPnpmVersion: ExpectedPnpmVersion,
    });

    expect(report.exitCode).toBe(0);
    expect(report.output).toContain("repo command shell is usable");
    expect(report.output).toContain("Run repo commands directly");
    expect(report.output).toContain("pnpm check:fast");
    expect(report.output).not.toContain("nix develop --command pnpm check:fast");
  });

  it("recommends the Nix wrapper when bare pnpm fails but Nix reaches the expected version", () => {
    const report = createAgentBootstrapDoctorReport({
      directPnpm: failedProbe(
        ["pnpm", "--version"],
        1,
        "mise ERROR No version is set for shim: pnpm",
      ),
      nixPnpm: successfulProbe(
        ["nix", "develop", "--command", "pnpm", "--version"],
        ExpectedPnpmVersion,
      ),
      expectedPnpmVersion: ExpectedPnpmVersion,
    });

    expect(report.exitCode).toBe(0);
    expect(report.output).toContain("repo commands require the Nix development shell");
    expect(report.output).toContain("mise ERROR No version is set for shim: pnpm");
    expect(report.output).toContain("Nix-wrapped pnpm: OK (11.4.0)");
    expect(report.output).toContain("nix develop --command pnpm check:fast");
  });

  it("fails with both probe diagnostics when neither command reaches the expected version", () => {
    const report = createAgentBootstrapDoctorReport({
      directPnpm: failedProbe(["pnpm", "--version"], 1, "pnpm shim failed"),
      nixPnpm: failedProbe(
        ["nix", "develop", "--command", "pnpm", "--version"],
        127,
        "nix: command not found",
      ),
      expectedPnpmVersion: ExpectedPnpmVersion,
    });

    expect(report.exitCode).toBe(1);
    expect(report.output).toContain("repo command shell is not usable");
    expect(report.output).toContain("Direct pnpm: failed with exit code 1");
    expect(report.output).toContain("Nix-wrapped pnpm: failed with exit code 127");
    expect(report.output).toContain("Expected pnpm version: 11.4.0");
  });

  it("includes missing executable errors in failed probe diagnostics", () => {
    const report = createAgentBootstrapDoctorReport({
      directPnpm: unavailableProbe(["pnpm", "--version"], "spawnSync pnpm ENOENT"),
      nixPnpm: unavailableProbe(
        ["nix", "develop", "--command", "pnpm", "--version"],
        "spawnSync nix ENOENT",
      ),
      expectedPnpmVersion: ExpectedPnpmVersion,
    });

    expect(report.exitCode).toBe(1);
    expect(report.output).toContain("Direct pnpm: failed with exit code unavailable");
    expect(report.output).toContain("error: spawnSync pnpm ENOENT");
    expect(report.output).toContain("Nix-wrapped pnpm: failed with exit code unavailable");
    expect(report.output).toContain("error: spawnSync nix ENOENT");
  });

  it("does not accept a reachable command with the wrong pnpm version", () => {
    const report = createAgentBootstrapDoctorReport({
      directPnpm: successfulProbe(["pnpm", "--version"], "10.28.1"),
      nixPnpm: successfulProbe(["nix", "develop", "--command", "pnpm", "--version"], "10.28.1"),
      expectedPnpmVersion: ExpectedPnpmVersion,
    });

    expect(report.exitCode).toBe(1);
    expect(report.output).toContain("stdout: 10.28.1");
    expect(report.output).toContain("Expected pnpm version: 11.4.0");
  });

  it("labels a reachable but mismatched direct pnpm as the wrong version", () => {
    const report = createAgentBootstrapDoctorReport({
      directPnpm: successfulProbe(["pnpm", "--version"], "10.28.1"),
      nixPnpm: successfulProbe(
        ["nix", "develop", "--command", "pnpm", "--version"],
        ExpectedPnpmVersion,
      ),
      expectedPnpmVersion: ExpectedPnpmVersion,
    });

    expect(report.exitCode).toBe(0);
    expect(report.output).toContain("Direct pnpm: reached unexpected pnpm version 10.28.1");
    expect(report.output).toContain("Nix-wrapped pnpm: OK (11.4.0)");
    expect(report.output).toContain("nix develop --command pnpm check:fast");
  });
});

describe("readExpectedPnpmVersionFromPackageJsonValue", () => {
  it("reads the expected pnpm version from root package metadata", () => {
    expect(readExpectedPnpmVersionFromPackageJsonValue({ packageManager: "pnpm@11.4.0" })).toBe(
      "11.4.0",
    );
  });

  it("fails fast when root package metadata does not pin pnpm", () => {
    expect(() =>
      readExpectedPnpmVersionFromPackageJsonValue({ packageManager: "npm@10.0.0" }),
    ).toThrow("Root package.json packageManager must start with pnpm@.");
  });
});

function successfulProbe(command: readonly string[], stdout: string): CommandProbeResult {
  return {
    command,
    exitCode: 0,
    stderr: "",
    stdout,
  };
}

function failedProbe(
  command: readonly string[],
  exitCode: number,
  stderr: string,
): CommandProbeResult {
  return {
    command,
    exitCode,
    stderr,
    stdout: "",
  };
}

function unavailableProbe(command: readonly string[], errorMessage: string): CommandProbeResult {
  return {
    command,
    errorMessage,
    exitCode: null,
    stderr: "",
    stdout: "",
  };
}
