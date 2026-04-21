import { describe, expect, it } from "vitest";

import {
  parseSandboxTelemetryLogLine,
  toSandboxTunnelMetricObservation,
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

  it("parses structured bootstrap warning log lines emitted by sandboxd", () => {
    expect(
      parseSandboxTelemetryLogLine(
        `{"timestamp":"1970-01-01T00:00:00.104Z","level":"warn","event":"bootstrap_control_message_dropped","message":"sandboxd dropped bootstrap control message: unsupported control message type 'stream.reset'","reason":"unsupported control message type 'stream.reset'"}`,
      ),
    ).toEqual({
      timestamp: new Date("1970-01-01T00:00:00.104Z"),
      level: "warn",
      event: "bootstrap_control_message_dropped",
      extraFields: {
        message:
          "sandboxd dropped bootstrap control message: unsupported control message type 'stream.reset'",
        reason: "unsupported control message type 'stream.reset'",
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
        "mistle.delivery.correlation_scope": "transport_only",
        "mistle.sandbox.instance.id": "sbi_test",
        "mistle.sandbox.instance_id": "sbi_test",
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

describe("toSandboxTunnelMetricObservation", () => {
  it("maps agent stream summary telemetry into metric observations", () => {
    expect(
      toSandboxTunnelMetricObservation(
        parseSandboxTelemetryLogLine(
          '{"timestamp":"2026-04-20T09:00:00.000Z","level":"info","event":"agent_stream_summary","streamId":7,"channelKind":"agent","outcome":"reset","closeSource":"runtime","durationMs":1200,"messageCountOut":3,"messageCountIn":2,"totalBytesOut":4096,"totalBytesIn":1536,"maxMessageBytesOut":2048,"maxMessageBytesIn":1024,"maxOutstandingBytes":3072,"avgCreditReturnMs":18,"creditReturnCount":3,"resetCode":"stream_window_exhausted","reason":"agent stream send window is exhausted"}',
        ),
      ),
    ).toEqual({
      kind: "agent_stream_summary",
      channelKind: "agent",
      outcome: "reset",
      durationMs: 1200,
      totalBytesOut: 4096,
      totalBytesIn: 1536,
      maxMessageBytesOut: 2048,
      maxMessageBytesIn: 1024,
      maxOutstandingBytes: 3072,
      avgCreditReturnMs: 18,
      resetCode: "stream_window_exhausted",
    });
  });

  it("maps agent stream exhaustion telemetry into metric observations", () => {
    expect(
      toSandboxTunnelMetricObservation(
        parseSandboxTelemetryLogLine(
          '{"timestamp":"2026-04-20T09:00:00.000Z","level":"warn","event":"agent_stream_window_exhausted","streamId":7,"channelKind":"agent","payloadKind":"websocket_text","payloadBytes":8388608,"availableBytes":1024,"outstandingBytes":16776192,"maxWindowBytes":16777216,"payloadExceedsMaxWindow":false,"payloadExceedsAvailableWindow":true,"messageCountOut":4,"streamAgeMs":9000,"oldestUnackedMs":250}',
        ),
      ),
    ).toEqual({
      kind: "agent_stream_window_exhausted",
      channelKind: "agent",
      payloadKind: "websocket_text",
      payloadBytes: 8388608,
      outstandingBytes: 16776192,
    });
  });

  it("maps PTY latency warning telemetry into metric observations", () => {
    expect(
      toSandboxTunnelMetricObservation(
        parseSandboxTelemetryLogLine(
          '{"timestamp":"2026-04-20T09:00:00.000Z","level":"warn","event":"pty_input_latency_warning","ptySessionId":"pty_123","streamId":11,"channelKind":"pty","thresholdMs":100,"inputToFirstOutputMs":145,"inputBytes":1,"outputBytes":24,"interactionCount":3,"sessionAgeMs":9000}',
        ),
      ),
    ).toEqual({
      kind: "pty_input_latency_warning",
      inputToFirstOutputMs: 145,
      inputBytes: 1,
      outputBytes: 24,
    });
  });

  it("maps PTY session summary telemetry into metric observations", () => {
    expect(
      toSandboxTunnelMetricObservation(
        parseSandboxTelemetryLogLine(
          '{"timestamp":"2026-04-20T09:00:00.000Z","level":"info","event":"pty_session_summary","ptySessionId":"pty_123","streamId":11,"channelKind":"pty","outcome":"closed","durationMs":12000,"interactionCount":6,"warningCount":2,"avgInputToFirstOutputMs":82,"maxInputToFirstOutputMs":190,"resetCode":null,"reason":null}',
        ),
      ),
    ).toEqual({
      kind: "pty_session_summary",
      durationMs: 12000,
      interactionCount: 6,
      warningCount: 2,
      avgInputToFirstOutputMs: 82,
      maxInputToFirstOutputMs: 190,
    });
  });
});
