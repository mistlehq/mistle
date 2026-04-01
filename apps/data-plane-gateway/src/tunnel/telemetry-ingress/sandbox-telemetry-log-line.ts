import { SeverityNumber, type LogRecord } from "@mistle/telemetry";
import type { Clock } from "@mistle/time";

import { SandboxTelemetryResetError } from "./sandbox-telemetry-reset-error.js";

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSandboxTelemetryLogValue(value: unknown): value is SandboxTelemetryLogValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function toInvalidTelemetryLogShapeError(): SandboxTelemetryResetError {
  return new SandboxTelemetryResetError({
    code: "invalid_telemetry_log_shape",
    message: InvalidTelemetryLogShapeMessage,
  });
}

function parseTimestamp(rawTimestamp: unknown): Date {
  if (typeof rawTimestamp !== "string") {
    throw toInvalidTelemetryLogShapeError();
  }

  const timestamp = new Date(rawTimestamp);
  if (Number.isNaN(timestamp.getTime())) {
    throw toInvalidTelemetryLogShapeError();
  }

  return timestamp;
}

function parseLevel(rawLevel: unknown): SandboxTelemetryLogLevel {
  if (rawLevel === "info" || rawLevel === "warn" || rawLevel === "error") {
    return rawLevel;
  }

  throw toInvalidTelemetryLogShapeError();
}

function parseEvent(rawEvent: unknown): string {
  if (typeof rawEvent !== "string" || rawEvent.trim().length === 0) {
    throw toInvalidTelemetryLogShapeError();
  }

  return rawEvent;
}

function toSeverityNumber(level: SandboxTelemetryLogLevel): SeverityNumber {
  switch (level) {
    case "info":
      return SeverityNumber.INFO;
    case "warn":
      return SeverityNumber.WARN;
    case "error":
      return SeverityNumber.ERROR;
  }
}

function toSeverityText(level: SandboxTelemetryLogLevel): "INFO" | "WARN" | "ERROR" {
  switch (level) {
    case "info":
      return "INFO";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
  }
}

export function parseSandboxTelemetryLogLine(line: string): ParsedSandboxTelemetryLogLine {
  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(line);
  } catch {
    throw toInvalidTelemetryLogShapeError();
  }

  if (!isObjectRecord(parsedValue)) {
    throw toInvalidTelemetryLogShapeError();
  }

  const extraFields: Record<string, SandboxTelemetryLogValue> = {};
  for (const [fieldName, fieldValue] of Object.entries(parsedValue)) {
    if (ReservedSandboxTelemetryFields.has(fieldName)) {
      continue;
    }

    if (!isSandboxTelemetryLogValue(fieldValue)) {
      throw toInvalidTelemetryLogShapeError();
    }

    extraFields[fieldName] = fieldValue;
  }

  return {
    timestamp: parseTimestamp(parsedValue.timestamp),
    level: parseLevel(parsedValue.level),
    event: parseEvent(parsedValue.event),
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

  return {
    timestamp: input.logLine.timestamp,
    observedTimestamp: input.clock.nowDate(),
    severityNumber: toSeverityNumber(input.logLine.level),
    severityText: toSeverityText(input.logLine.level),
    eventName: input.logLine.event,
    body: input.logLine.event,
    attributes,
  };
}
