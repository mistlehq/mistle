import { SeverityNumber, type LogRecord } from "@mistle/telemetry";
import type { Clock } from "@mistle/time";

import { SandboxTelemetryResetError } from "./errors.js";

type SandboxTelemetryLogLevel = "info" | "warn" | "error";
type SandboxTelemetryLogValue = string | number | boolean | null;
type ParsedSandboxTelemetryLogLine = {
  event: string;
  extraFields: Readonly<Record<string, SandboxTelemetryLogValue>>;
  level: SandboxTelemetryLogLevel;
  timestamp: Date;
};

const InvalidTelemetryLogShapeMessage =
  "Telemetry log line does not match mistle.sandbox-runtime.log.v1.";
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
