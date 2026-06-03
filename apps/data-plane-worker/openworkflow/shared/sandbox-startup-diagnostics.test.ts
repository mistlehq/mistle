import { describe, expect, it } from "vitest";

import {
  parseStartupDiagnostics,
  summarizeStartupDiagnosticPhaseTimings,
  toDiagnosticAttributes,
} from "./sandbox-startup-diagnostics.js";

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

  it("parses activation diagnostic records with operation kind details", () => {
    const logText = [
      JSON.stringify({
        timestamp: "2026-04-21T01:02:03.000Z",
        level: "info",
        event: "sandbox_setup_check_started",
        sandboxInstanceId: "sbi_123",
        operation: "activate",
        operationKind: "setup_check",
      }),
      JSON.stringify({
        timestamp: "2026-04-21T01:02:05.000Z",
        level: "error",
        event: "sandbox_setup_check_phase_failed",
        sandboxInstanceId: "sbi_123",
        operation: "activate",
        operationKind: "setup_check",
        phase: "apply_runtime_plan",
        failureKind: "workspace_source_failed",
        originUrl: "https://github.com/acme/abc.git",
      }),
    ].join("\n");

    const result = parseStartupDiagnostics(logText);

    expect(result.parseErrors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.operation).toBe("activate");
    expect(result.records[0]?.operationKind).toBe("setup_check");
    expect(result.records[1]?.event).toBe("sandbox_setup_check_phase_failed");
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

  it("maps activation operation kind into OTEL-compatible attributes", () => {
    const attributes = toDiagnosticAttributes({
      timestamp: "2026-04-21T01:02:05.000Z",
      level: "error",
      event: "sandbox_snapshot_phase_failed",
      sandboxInstanceId: "sbi_123",
      operation: "activate",
      operationKind: "snapshot",
      phase: "apply_runtime_plan",
    });

    expect(attributes).toMatchObject({
      "mistle.sandbox.instance_id": "sbi_123",
      "mistle.sandbox.startup_operation": "activate",
      "mistle.sandbox.startup_operation_kind": "snapshot",
      "mistle.sandbox.startup_event": "sandbox_snapshot_phase_failed",
      "mistle.sandbox.startup_phase": "apply_runtime_plan",
      "mistle.sandbox.startup_detail.operationKind": "snapshot",
    });
  });
});

describe("summarizeStartupDiagnosticPhaseTimings", () => {
  it("summarizes completed startup phase durations from high precision timestamps", () => {
    const { records } = parseStartupDiagnostics(
      [
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.100123456Z",
          level: "info",
          event: "sandbox_init_phase_started",
          sandboxInstanceId: "sbi_123",
          operation: "init",
          phase: "start_tunnel_session",
        }),
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.350987654Z",
          level: "info",
          event: "sandbox_init_phase_completed",
          sandboxInstanceId: "sbi_123",
          operation: "init",
          phase: "start_tunnel_session",
        }),
        JSON.stringify({
          timestamp: "2026-05-25T08:16:47.000000001Z",
          level: "info",
          event: "sandbox_init_transcript",
          sandboxInstanceId: "sbi_123",
          operation: "init",
          phase: "start_tunnel_session",
        }),
      ].join("\n"),
    );

    const summary = summarizeStartupDiagnosticPhaseTimings(records);

    expect(summary.skippedRecords).toEqual([]);
    expect(summary.phaseTimings).toEqual([
      {
        completedAt: "2026-05-25T08:16:46.350987654Z",
        durationMs: 250,
        phase: "start_tunnel_session",
        startedAt: "2026-05-25T08:16:46.100123456Z",
      },
    ]);
  });

  it("summarizes activation phase durations from operation-kind-specific events", () => {
    const { records } = parseStartupDiagnostics(
      [
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.100Z",
          level: "info",
          event: "sandbox_setup_check_phase_started",
          sandboxInstanceId: "sbi_123",
          operation: "activate",
          operationKind: "setup_check",
          phase: "apply_runtime_plan",
        }),
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.350Z",
          level: "info",
          event: "sandbox_setup_check_phase_completed",
          sandboxInstanceId: "sbi_123",
          operation: "activate",
          operationKind: "setup_check",
          phase: "apply_runtime_plan",
        }),
      ].join("\n"),
    );

    const summary = summarizeStartupDiagnosticPhaseTimings(records);

    expect(summary.skippedRecords).toEqual([]);
    expect(summary.phaseTimings).toEqual([
      {
        completedAt: "2026-05-25T08:16:46.350Z",
        durationMs: 250,
        phase: "apply_runtime_plan",
        startedAt: "2026-05-25T08:16:46.100Z",
      },
    ]);
  });

  it("skips activation phase records that do not identify the operation kind", () => {
    const { records } = parseStartupDiagnostics(
      JSON.stringify({
        timestamp: "2026-05-25T08:16:46.100Z",
        level: "info",
        event: "sandbox_setup_check_phase_started",
        sandboxInstanceId: "sbi_123",
        operation: "activate",
        phase: "apply_runtime_plan",
      }),
    );

    const summary = summarizeStartupDiagnosticPhaseTimings(records);

    expect(summary.phaseTimings).toEqual([]);
    expect(summary.skippedRecords).toEqual([
      "phase apply_runtime_plan activation record is missing operationKind",
    ]);
  });

  it("reports completed phases that do not have matching start records", () => {
    const { records } = parseStartupDiagnostics(
      JSON.stringify({
        timestamp: "2026-05-25T08:16:46.350Z",
        level: "info",
        event: "sandbox_resume_phase_completed",
        sandboxInstanceId: "sbi_123",
        operation: "resume",
        phase: "start_tunnel_session",
      }),
    );

    const summary = summarizeStartupDiagnosticPhaseTimings(records);

    expect(summary.phaseTimings).toEqual([]);
    expect(summary.skippedRecords).toEqual([
      "phase start_tunnel_session completed without a matching start record",
    ]);
  });

  it("does not reuse a matched start record for duplicate phase completions", () => {
    const { records } = parseStartupDiagnostics(
      [
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.100Z",
          level: "info",
          event: "sandbox_init_phase_started",
          sandboxInstanceId: "sbi_123",
          operation: "init",
          phase: "start_tunnel_session",
        }),
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.350Z",
          level: "info",
          event: "sandbox_init_phase_completed",
          sandboxInstanceId: "sbi_123",
          operation: "init",
          phase: "start_tunnel_session",
        }),
        JSON.stringify({
          timestamp: "2026-05-25T08:16:46.500Z",
          level: "info",
          event: "sandbox_init_phase_completed",
          sandboxInstanceId: "sbi_123",
          operation: "init",
          phase: "start_tunnel_session",
        }),
      ].join("\n"),
    );

    const summary = summarizeStartupDiagnosticPhaseTimings(records);

    expect(summary.phaseTimings).toEqual([
      {
        completedAt: "2026-05-25T08:16:46.350Z",
        durationMs: 250,
        phase: "start_tunnel_session",
        startedAt: "2026-05-25T08:16:46.100Z",
      },
    ]);
    expect(summary.skippedRecords).toEqual([
      "phase start_tunnel_session completed without a matching start record",
    ]);
  });
});
