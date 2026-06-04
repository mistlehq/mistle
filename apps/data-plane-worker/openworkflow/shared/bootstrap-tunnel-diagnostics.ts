import { z } from "zod";

const BootstrapTunnelOperationLogTextLimitBytes = 64 * 1024;

const BootstrapTunnelDiagnosticRecordSchema = z
  .object({
    timestampMs: z.number(),
    event: z.string(),
  })
  .catchall(z.unknown());

export type BootstrapTunnelDiagnosticRecord = z.output<
  typeof BootstrapTunnelDiagnosticRecordSchema
>;

export function parseBootstrapTunnelDiagnostics(logText: string): {
  records: BootstrapTunnelDiagnosticRecord[];
  parseErrors: string[];
} {
  const records: BootstrapTunnelDiagnosticRecord[] = [];
  const parseErrors: string[] = [];

  for (const [index, line] of logText.split("\n").entries()) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(trimmedLine);
    } catch (error) {
      parseErrors.push(
        `line ${String(index + 1)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const parsedRecord = BootstrapTunnelDiagnosticRecordSchema.safeParse(parsedJson);
    if (!parsedRecord.success) {
      parseErrors.push(
        `line ${String(index + 1)} does not match bootstrap tunnel diagnostic schema: ${parsedRecord.error.message}`,
      );
      continue;
    }

    records.push(parsedRecord.data);
  }

  return {
    records,
    parseErrors,
  };
}

export function summarizeBootstrapTunnelDiagnostics(logText: string): Record<string, unknown> {
  const { records, parseErrors } = parseBootstrapTunnelDiagnostics(logText);
  const firstRecord = records[0];
  const lastRecord = records.at(-1);
  const lastCloseRecord = findLastRecordWithAnyField(records, [
    "closeSource",
    "closeKind",
    "closeCode",
    "closeReason",
  ]);
  const lastErrorRecord = findLastRecordWithAnyField(records, ["error"]);
  const lastReasonRecord = findLastRecordWithAnyField(records, ["reason"]);
  const connectFailureRecord = findLastRecordByEvent(records, "bootstrap_tunnel.connect_failed");
  const tokenExchangeFailureRecord = findLastRecordByEvent(
    records,
    "bootstrap_tunnel.token_exchange_failed",
  );

  return {
    bootstrapTunnelEventCount: records.length,
    bootstrapTunnelParseErrorCount: parseErrors.length,
    ...(parseErrors.length === 0 ? {} : { bootstrapTunnelParseErrors: parseErrors }),
    ...(firstRecord === undefined
      ? {}
      : {
          bootstrapTunnelFirstEvent: firstRecord.event,
          bootstrapTunnelFirstTimestampMs: firstRecord.timestampMs,
        }),
    ...(lastRecord === undefined
      ? {}
      : {
          bootstrapTunnelLastEvent: lastRecord.event,
          bootstrapTunnelLastTimestampMs: lastRecord.timestampMs,
        }),
    ...optionalStringAttribute(
      "bootstrapTunnelLastCloseSource",
      fieldAsString(lastCloseRecord, "closeSource"),
    ),
    ...optionalStringAttribute(
      "bootstrapTunnelLastCloseKind",
      fieldAsString(lastCloseRecord, "closeKind"),
    ),
    ...optionalStringAttribute(
      "bootstrapTunnelLastCloseCode",
      fieldAsString(lastCloseRecord, "closeCode"),
    ),
    ...optionalStringAttribute(
      "bootstrapTunnelLastCloseReason",
      fieldAsString(lastCloseRecord, "closeReason"),
    ),
    ...optionalStringAttribute(
      "bootstrapTunnelLastReason",
      fieldAsString(lastReasonRecord, "reason"),
    ),
    ...optionalStringAttribute("bootstrapTunnelLastError", fieldAsString(lastErrorRecord, "error")),
    ...optionalStringAttribute(
      "bootstrapTunnelConnectFailureError",
      fieldAsString(connectFailureRecord, "error"),
    ),
    ...optionalStringAttribute(
      "bootstrapTunnelTokenExchangeFailureError",
      fieldAsString(tokenExchangeFailureRecord, "error"),
    ),
    bootstrapTunnelShutdownRequested: records.some(isShutdownRequestedRecord),
  };
}

export function toBoundedOperationLogTextAttributes(logText: string): {
  operationLogByteLength: number;
  operationLogText: string;
  operationLogTextTruncated: boolean;
} {
  const operationLogByteLength = Buffer.byteLength(logText, "utf8");
  if (operationLogByteLength <= BootstrapTunnelOperationLogTextLimitBytes) {
    return {
      operationLogByteLength,
      operationLogText: logText,
      operationLogTextTruncated: false,
    };
  }

  return {
    operationLogByteLength,
    operationLogText: Buffer.from(logText, "utf8")
      .subarray(0, BootstrapTunnelOperationLogTextLimitBytes)
      .toString("utf8"),
    operationLogTextTruncated: true,
  };
}

function findLastRecordByEvent(
  records: readonly BootstrapTunnelDiagnosticRecord[],
  event: string,
): BootstrapTunnelDiagnosticRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.event === event) {
      return record;
    }
  }

  return undefined;
}

function findLastRecordWithAnyField(
  records: readonly BootstrapTunnelDiagnosticRecord[],
  fieldNames: readonly string[],
): BootstrapTunnelDiagnosticRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    if (fieldNames.some((fieldName) => record[fieldName] !== undefined)) {
      return record;
    }
  }

  return undefined;
}

function fieldAsString(
  record: BootstrapTunnelDiagnosticRecord | undefined,
  fieldName: string,
): string | undefined {
  if (record === undefined) {
    return undefined;
  }

  const value = record[fieldName];
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

function optionalStringAttribute(key: string, value: string | undefined): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  return {
    [key]: value,
  };
}

function isShutdownRequestedRecord(record: BootstrapTunnelDiagnosticRecord): boolean {
  return (
    record.event === "bootstrap_tunnel.shutdown_requested" ||
    record.event === "bootstrap_tunnel.session_shutdown_observed" ||
    record.event === "bootstrap_tunnel.reconnect_stopped"
  );
}
