import { SeverityNumber, type LogRecord } from "@mistle/telemetry";
import type { Clock } from "@mistle/time";

import { SandboxTelemetryResetError } from "./errors.js";

type SandboxTelemetryLogLevel = "info" | "warn" | "error";
type SandboxTelemetryLogValue = string | number | boolean | null;
export type ParsedSandboxTelemetryLogLine = {
  event: string;
  extraFields: Readonly<Record<string, SandboxTelemetryLogValue>>;
  level: SandboxTelemetryLogLevel;
  timestamp: Date;
};

export type SandboxTunnelMetricObservation =
  | {
      kind: "agent_stream_summary";
      avgCreditReturnMs: number | null;
      channelKind: string;
      durationMs: number;
      maxMessageBytesIn: number;
      maxMessageBytesOut: number;
      maxOutstandingBytes: number;
      outcome: string;
      resetCode: string | null;
      totalBytesIn: number;
      totalBytesOut: number;
    }
  | {
      kind: "agent_stream_window_exhausted";
      channelKind: string;
      outstandingBytes: number;
      payloadBytes: number;
      payloadKind: string;
    }
  | {
      kind: "pty_input_latency_warning";
      inputBytes: number;
      inputToFirstOutputMs: number;
      outputBytes: number;
    }
  | {
      kind: "pty_session_summary";
      avgInputToFirstOutputMs: number | null;
      durationMs: number;
      interactionCount: number;
      maxInputToFirstOutputMs: number | null;
      warningCount: number;
    };

const InvalidTelemetryLogShapeMessage =
  "Telemetry log line does not match mistle.sandbox-runtime.log.v1.";
const AgentStreamSummaryEvent = "agent_stream_summary";
const AgentStreamWindowExhaustedEvent = "agent_stream_window_exhausted";
const PtyInputLatencyWarningEvent = "pty_input_latency_warning";
const PtySessionSummaryEvent = "pty_session_summary";
const ReservedSandboxTelemetryFields = new Set(["timestamp", "level", "event"]);
const SeverityNumberByLevel = {
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
} satisfies Record<SandboxTelemetryLogLevel, SeverityNumber>;

function isSandboxTelemetryLogValue(value: unknown): value is SandboxTelemetryLogValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function parseTimestamp(rawTimestamp: unknown): Date {
  if (typeof rawTimestamp !== "string") {
    throw new SandboxTelemetryResetError({
      code: "invalid_telemetry_log_shape",
      message: InvalidTelemetryLogShapeMessage,
    });
  }

  const timestamp = new Date(rawTimestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw new SandboxTelemetryResetError({
      code: "invalid_telemetry_log_shape",
      message: InvalidTelemetryLogShapeMessage,
    });
  }

  return timestamp;
}

function parseLevel(rawLevel: unknown): SandboxTelemetryLogLevel {
  if (rawLevel === "info" || rawLevel === "warn" || rawLevel === "error") {
    return rawLevel;
  }

  throw new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: InvalidTelemetryLogShapeMessage,
  });
}

function parseEvent(rawEvent: unknown): string {
  if (typeof rawEvent !== "string" || rawEvent.trim().length === 0) {
    throw new SandboxTelemetryResetError({
      code: "invalid_telemetry_log_shape",
      message: InvalidTelemetryLogShapeMessage,
    });
  }

  return rawEvent;
}

function getStringField(
  fields: Readonly<Record<string, SandboxTelemetryLogValue>>,
  fieldName: string,
): string {
  const value = fields[fieldName];
  if (typeof value === "string") {
    return value;
  }

  throw new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: InvalidTelemetryLogShapeMessage,
  });
}

function getNumberField(
  fields: Readonly<Record<string, SandboxTelemetryLogValue>>,
  fieldName: string,
): number {
  const value = fields[fieldName];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  throw new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: InvalidTelemetryLogShapeMessage,
  });
}

function getNullableNumberField(
  fields: Readonly<Record<string, SandboxTelemetryLogValue>>,
  fieldName: string,
): number | null {
  const value = fields[fieldName];
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  throw new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: InvalidTelemetryLogShapeMessage,
  });
}

function getNullableStringField(
  fields: Readonly<Record<string, SandboxTelemetryLogValue>>,
  fieldName: string,
): string | null {
  const value = fields[fieldName];
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }

  throw new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: InvalidTelemetryLogShapeMessage,
  });
}

export function parseSandboxTelemetryLogLine(line: string): ParsedSandboxTelemetryLogLine {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(line);
  } catch {
    throw new SandboxTelemetryResetError({
      code: "invalid_telemetry_log_shape",
      message: InvalidTelemetryLogShapeMessage,
    });
  }

  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    throw new SandboxTelemetryResetError({
      code: "invalid_telemetry_log_shape",
      message: InvalidTelemetryLogShapeMessage,
    });
  }

  const parsedEntries = new Map(Object.entries(parsedValue));
  const extraFields: Record<string, SandboxTelemetryLogValue> = {};
  for (const [fieldName, fieldValue] of parsedEntries) {
    if (ReservedSandboxTelemetryFields.has(fieldName)) {
      continue;
    }

    if (!isSandboxTelemetryLogValue(fieldValue)) {
      throw new SandboxTelemetryResetError({
        code: "invalid_telemetry_log_shape",
        message: InvalidTelemetryLogShapeMessage,
      });
    }

    extraFields[fieldName] = fieldValue;
  }

  return {
    timestamp: parseTimestamp(parsedEntries.get("timestamp")),
    level: parseLevel(parsedEntries.get("level")),
    event: parseEvent(parsedEntries.get("event")),
    extraFields,
  };
}

export function toSandboxTelemetryLogRecord(input: {
  clock: Clock;
  gatewayNodeId: string;
  relaySessionId: string;
  sandboxInstanceId: string;
  logLine: ParsedSandboxTelemetryLogLine;
}): LogRecord {
  const attributes: Record<string, string | number | boolean | null> = {
    "mistle.sandbox.instance.id": input.sandboxInstanceId,
    "mistle.gateway.node.id": input.gatewayNodeId,
    "mistle.tunnel.relay_session_id": input.relaySessionId,
    "mistle.telemetry.transport": "bootstrap_tunnel",
    "mistle.telemetry.signal": "logs",
    "mistle.sandbox.log.event": input.logLine.event,
  };

  for (const [fieldName, fieldValue] of Object.entries(input.logLine.extraFields)) {
    attributes[`mistle.sandbox.log.${fieldName}`] = fieldValue;
  }

  const severityText = input.logLine.level.toUpperCase();

  return {
    timestamp: input.logLine.timestamp,
    observedTimestamp: input.clock.nowDate(),
    severityNumber: SeverityNumberByLevel[input.logLine.level],
    severityText,
    eventName: input.logLine.event,
    body: input.logLine.event,
    attributes,
  };
}

export function toSandboxTunnelMetricObservation(
  logLine: ParsedSandboxTelemetryLogLine,
): SandboxTunnelMetricObservation | undefined {
  if (logLine.event === AgentStreamSummaryEvent) {
    return {
      kind: "agent_stream_summary",
      channelKind: getStringField(logLine.extraFields, "channelKind"),
      outcome: getStringField(logLine.extraFields, "outcome"),
      durationMs: getNumberField(logLine.extraFields, "durationMs"),
      totalBytesOut: getNumberField(logLine.extraFields, "totalBytesOut"),
      totalBytesIn: getNumberField(logLine.extraFields, "totalBytesIn"),
      maxMessageBytesOut: getNumberField(logLine.extraFields, "maxMessageBytesOut"),
      maxMessageBytesIn: getNumberField(logLine.extraFields, "maxMessageBytesIn"),
      maxOutstandingBytes: getNumberField(logLine.extraFields, "maxOutstandingBytes"),
      avgCreditReturnMs: getNullableNumberField(logLine.extraFields, "avgCreditReturnMs"),
      resetCode: getNullableStringField(logLine.extraFields, "resetCode"),
    };
  }

  if (logLine.event === AgentStreamWindowExhaustedEvent) {
    return {
      kind: "agent_stream_window_exhausted",
      channelKind: getStringField(logLine.extraFields, "channelKind"),
      payloadKind: getStringField(logLine.extraFields, "payloadKind"),
      payloadBytes: getNumberField(logLine.extraFields, "payloadBytes"),
      outstandingBytes: getNumberField(logLine.extraFields, "outstandingBytes"),
    };
  }

  if (logLine.event === PtyInputLatencyWarningEvent) {
    return {
      kind: "pty_input_latency_warning",
      inputToFirstOutputMs: getNumberField(logLine.extraFields, "inputToFirstOutputMs"),
      inputBytes: getNumberField(logLine.extraFields, "inputBytes"),
      outputBytes: getNumberField(logLine.extraFields, "outputBytes"),
    };
  }

  if (logLine.event === PtySessionSummaryEvent) {
    return {
      kind: "pty_session_summary",
      durationMs: getNumberField(logLine.extraFields, "durationMs"),
      interactionCount: getNumberField(logLine.extraFields, "interactionCount"),
      warningCount: getNumberField(logLine.extraFields, "warningCount"),
      avgInputToFirstOutputMs: getNullableNumberField(
        logLine.extraFields,
        "avgInputToFirstOutputMs",
      ),
      maxInputToFirstOutputMs: getNullableNumberField(
        logLine.extraFields,
        "maxInputToFirstOutputMs",
      ),
    };
  }

  return undefined;
}
