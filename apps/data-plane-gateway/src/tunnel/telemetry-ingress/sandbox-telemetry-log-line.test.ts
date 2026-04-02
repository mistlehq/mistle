import { describe, expect, it } from "vitest";

import {
  parseSandboxTelemetryLogLine,
  toSandboxTelemetryLogRecord,
} from "./sandbox-telemetry-log-line.js";

describe("parseSandboxTelemetryLogLine", () => {
  it("parses sandbox runtime log lines with scalar extra fields", () => {
    expect(
      parseSandboxTelemetryLogLine(
        '{"timestamp":"2026-04-02T09:00:00.000Z","level":"warn","event":"sandbox_runtime_slow_start","elapsedMs":1200,"startupMode":"warm","startupReady":false,"reason":null}',
      ),
    ).toEqual({
      timestamp: new Date("2026-04-02T09:00:00.000Z"),
      level: "warn",
      event: "sandbox_runtime_slow_start",
      extraFields: {
        elapsedMs: 1200,
        startupMode: "warm",
        startupReady: false,
        reason: null,
      },
    });
  });

  it("rejects non-scalar extra fields", () => {
    expect(() =>
      parseSandboxTelemetryLogLine(
        '{"timestamp":"2026-04-02T09:00:00.000Z","level":"info","event":"sandbox_runtime_invalid","details":{"kind":"nested"}}',
      ),
    ).toThrow("Telemetry log line does not match mistle.sandbox-runtime.log.v1.");
  });
});

describe("toSandboxTelemetryLogRecord", () => {
  it("maps parsed sandbox log lines into OTEL log records", () => {
    const fixedClock = {
      nowDate: () => new Date("2026-04-02T09:05:00.000Z"),
      nowMs: () => new Date("2026-04-02T09:05:00.000Z").getTime(),
    };

    const logRecord = toSandboxTelemetryLogRecord({
      clock: fixedClock,
      gatewayNodeId: "dpg_test",
      relaySessionId: "sess_bootstrap",
      sandboxInstanceId: "sbi_test",
      logLine: parseSandboxTelemetryLogLine(
        '{"timestamp":"2026-04-02T09:00:00.000Z","level":"error","event":"sandbox_runtime_failed","message":"boot failed","attempt":3,"retryable":false,"reason":null}',
      ),
    });

    expect(logRecord).toEqual({
      timestamp: new Date("2026-04-02T09:00:00.000Z"),
      observedTimestamp: new Date("2026-04-02T09:05:00.000Z"),
      severityNumber: 17,
      severityText: "ERROR",
      eventName: "sandbox_runtime_failed",
      body: "sandbox_runtime_failed",
      attributes: {
        "mistle.sandbox.instance.id": "sbi_test",
        "mistle.gateway.node.id": "dpg_test",
        "mistle.tunnel.relay_session_id": "sess_bootstrap",
        "mistle.telemetry.transport": "bootstrap_tunnel",
        "mistle.telemetry.signal": "logs",
        "mistle.sandbox.log.event": "sandbox_runtime_failed",
        "mistle.sandbox.log.message": "boot failed",
        "mistle.sandbox.log.attempt": 3,
        "mistle.sandbox.log.retryable": false,
        "mistle.sandbox.log.reason": null,
      },
    });
  });
});
