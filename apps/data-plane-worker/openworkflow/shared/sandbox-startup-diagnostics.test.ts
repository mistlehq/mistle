import { describe, expect, it } from "vitest";

import { parseStartupDiagnostics, toDiagnosticAttributes } from "./sandbox-startup-diagnostics.js";

describe("parseStartupDiagnostics", () => {
  it("parses valid startup diagnostic records and skips blank lines", () => {
    const logText = [
      "",
      JSON.stringify({
        timestamp: "2026-04-21T01:02:03.000Z",
        level: "info",
        event: "sandbox_init_started",
        sandboxInstanceId: "sbi_123",
        operation: "init",
      }),
      "   ",
      JSON.stringify({
        timestamp: "2026-04-21T01:02:05.000Z",
        level: "error",
        event: "sandbox_init_phase_failed",
        sandboxInstanceId: "sbi_123",
        operation: "init",
        phase: "apply_runtime_plan",
        failureKind: "workspace_source_failed",
        originUrl: "https://github.com/acme/abc.git",
      }),
    ].join("\n");

    const result = parseStartupDiagnostics(logText);

    expect(result.parseErrors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.event).toBe("sandbox_init_started");
    expect(result.records[1]?.phase).toBe("apply_runtime_plan");
    expect(result.records[1]?.originUrl).toBe("https://github.com/acme/abc.git");
  });

  it("reports invalid json and schema mismatches", () => {
    const result = parseStartupDiagnostics(
      [
        "{not-json}",
        JSON.stringify({
          timestamp: "2026-04-21T01:02:05.000Z",
          level: "warn",
          event: "sandbox_init_phase_failed",
          sandboxInstanceId: "sbi_123",
          operation: "init",
        }),
      ].join("\n"),
    );

    expect(result.records).toEqual([]);
    expect(result.parseErrors).toHaveLength(2);
    expect(result.parseErrors[0]).toContain("not valid JSON");
    expect(result.parseErrors[1]).toContain("does not match startup diagnostic schema");
  });
});

describe("toDiagnosticAttributes", () => {
  it("maps scalar record values into OTEL-compatible attributes", () => {
    const attributes = toDiagnosticAttributes({
      timestamp: "2026-04-21T01:02:05.000Z",
      level: "error",
      event: "sandbox_init_phase_failed",
      sandboxInstanceId: "sbi_123",
      operation: "init",
      phase: "start_runtime_processes",
      processKey: "codex-app-server",
      timeoutMs: 5_000,
      hasTail: true,
      stdoutCaptured: false,
      stderrCaptured: true,
    });

    expect(attributes).toMatchObject({
      "mistle.sandbox.instance_id": "sbi_123",
      "mistle.sandbox.startup_operation": "init",
      "mistle.sandbox.startup_event": "sandbox_init_phase_failed",
      "mistle.sandbox.startup_phase": "start_runtime_processes",
      "mistle.sandbox.startup_detail.processKey": "codex-app-server",
      "mistle.sandbox.startup_detail.timeoutMs": 5_000,
      "mistle.sandbox.startup_detail.hasTail": true,
      "mistle.sandbox.startup_detail.stdoutCaptured": false,
      "mistle.sandbox.startup_detail.stderrCaptured": true,
    });
  });
});
