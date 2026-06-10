import { describe, expect, it } from "vitest";

import {
  CloudflareTunnelEnvNames,
  type AgentDoctorState,
  createAgentDoctorReport,
  formatAgentDoctorReport,
  type CommandStatus,
} from "./doctor-agent.js";

describe("agent bootstrap doctor", () => {
  it("warns outside nix and recommends the nix pnpm wrapper without failing", () => {
    const report = createAgentDoctorReport(
      doctorState({
        pnpm: {
          available: false,
          detail: "mise ERROR No version is set for shim: pnpm",
        },
        runningInsideNix: false,
      }),
    );
    const output = formatAgentDoctorReport(report);

    expect(report.blockers).toEqual([]);
    expect(output).toContain("[warn] Nix shell activation: Not running inside nix develop.");
    expect(output).toContain("nix develop --command pnpm <command>");
  });

  it("reports the configured pnpm version and active shell inside nix", () => {
    const report = createAgentDoctorReport(
      doctorState({
        cloudflareTunnelEnvPresent: CloudflareTunnelEnvNames,
        runningInsideNix: true,
      }),
    );
    const output = formatAgentDoctorReport(report);

    expect(report.blockers).toEqual([]);
    expect(output).toContain("[ok] Nix shell activation: Running inside nix develop.");
    expect(output).toContain("[ok] pnpm: 11.4.0 (configured 11.4.0)");
  });

  it("reports missing optional files and tunnel env without creating them", () => {
    const report = createAgentDoctorReport(
      doctorState({
        cloudflareTunnelEnvPresent: [],
        localFiles: [
          { relativePath: "flake.nix", present: true },
          { relativePath: "pnpm-lock.yaml", present: true },
          { relativePath: "pnpm-workspace.yaml", present: true },
          { relativePath: "config/config.development.toml", present: false },
          { relativePath: ".env.dev", present: false },
          { relativePath: ".env.test", present: false },
        ],
        runningInsideNix: true,
      }),
    );
    const output = formatAgentDoctorReport(report);

    expect(report.blockers).toEqual([]);
    expect(output).toContain("[missing] .env.dev: missing");
    expect(output).toContain("[missing] .env.test: missing");
    expect(output).toContain("[missing] Cloudflare tunnel env: missing:");
  });

  it("blocks only when neither direct pnpm nor the nix wrapper is reachable", () => {
    const report = createAgentDoctorReport(
      doctorState({
        nix: missing("command not found"),
        pnpm: missing("command not found"),
        runningInsideNix: false,
      }),
    );

    expect(report.blockers).toContain(
      "pnpm: pnpm is not reachable directly and Nix is unavailable, so local validation cannot run.",
    );
  });

  it("keeps blocker diagnostics out of warnings", () => {
    const report = createAgentDoctorReport(
      doctorState({
        node: missing("command not found"),
      }),
    );
    const output = formatAgentDoctorReport(report);

    expect(report.blockers).toContain("Node: command not found");
    expect(report.warnings).not.toContain("Node: command not found");
    expect(output).toContain("[blocker] Node: command not found");
  });

  it("suggests repairing the active Nix shell when pnpm is missing inside Nix", () => {
    const report = createAgentDoctorReport(
      doctorState({
        pnpm: missing("command not found"),
        runningInsideNix: true,
      }),
    );

    expect(report.blockers).toContain("pnpm: command not found");
    expect(report.suggestedCommands).toContain("Re-enter the dev shell with nix develop.");
  });
});

function doctorState(overrides: Partial<AgentDoctorState> = {}): AgentDoctorState {
  return {
    cloudflared: available("cloudflared version 2026.1.0"),
    cloudflareTunnelEnvPresent: [],
    configuredPnpmVersion: "11.4.0",
    docker: available("Docker version 28.5.2"),
    dockerCompose: available("Docker Compose version v2.40.3"),
    localFiles: [
      { relativePath: "flake.nix", present: true },
      { relativePath: "pnpm-lock.yaml", present: true },
      { relativePath: "pnpm-workspace.yaml", present: true },
      { relativePath: "config/config.development.toml", present: true },
      { relativePath: ".env.dev", present: true },
      { relativePath: ".env.test", present: true },
    ],
    nix: available("nix (Nix) 2.32.4"),
    node: available("v25.2.1"),
    pnpm: available("11.4.0"),
    runningInsideNix: true,
    ...overrides,
  };
}

function available(output: string): CommandStatus {
  return {
    available: true,
    output,
  };
}

function missing(detail: string): CommandStatus {
  return {
    available: false,
    detail,
  };
}
