import type { MistleLogger } from "@mistle/logging";
import type { SandboxProvider, SandboxRuntimeControl } from "@mistle/sandbox";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { z } from "zod";

const StartupDiagnosticsTracer = trace.getTracer("@mistle/data-plane-worker");

const SandboxStartupDiagnosticRecordSchema = z
  .object({
    timestamp: z.string(),
    level: z.enum(["info", "error"]),
    event: z.string(),
    sandboxInstanceId: z.string(),
    operation: z.literal("activate"),
    operationKind: z.enum(["start", "resume", "setup_check", "snapshot"]),
    phase: z.string().optional(),
  })
  .catchall(z.unknown());

export type SandboxStartupDiagnosticRecord = z.output<typeof SandboxStartupDiagnosticRecordSchema>;

export type SandboxStartupDiagnosticPhaseTiming = {
  completedAt: string;
  durationMs: number;
  phase: string;
  startedAt: string;
};

export function toDiagnosticAttributes(record: SandboxStartupDiagnosticRecord): Attributes {
  const attributes: Attributes = {
    "mistle.sandbox.instance_id": record.sandboxInstanceId,
    "mistle.sandbox.startup_operation": record.operation,
    "mistle.sandbox.startup_event": record.event,
    ...(record.operationKind === undefined
      ? {}
      : {
          "mistle.sandbox.startup_operation_kind": record.operationKind,
        }),
    ...(record.phase === undefined
      ? {}
      : {
          "mistle.sandbox.startup_phase": record.phase,
        }),
  };

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[`mistle.sandbox.startup_detail.${key}`] = value;
    }
  }

  return attributes;
}

export function summarizeStartupDiagnosticPhaseTimings(
  records: readonly SandboxStartupDiagnosticRecord[],
): {
  phaseTimings: SandboxStartupDiagnosticPhaseTiming[];
  skippedRecords: string[];
} {
  const startedByPhase = new Map<string, { timestamp: string; timestampMs: number }>();
  const phaseTimings: SandboxStartupDiagnosticPhaseTiming[] = [];
  const skippedRecords: string[] = [];

  for (const record of records) {
    const phase = record.phase;
    if (phase === undefined) {
      continue;
    }

    const eventPrefix = diagnosticEventPrefix(record);
    const startedEvent = `${eventPrefix}_phase_started`;
    const completedEvent = `${eventPrefix}_phase_completed`;
    if (record.event !== startedEvent && record.event !== completedEvent) {
      continue;
    }

    const timestampMs = parseStartupDiagnosticTimestampMs(record.timestamp);
    if (timestampMs === null) {
      skippedRecords.push(
        `phase ${phase} has an unparsable timestamp '${record.timestamp}' for event ${record.event}`,
      );
      continue;
    }

    if (record.event === startedEvent) {
      startedByPhase.set(phase, {
        timestamp: record.timestamp,
        timestampMs,
      });
      continue;
    }

    const started = startedByPhase.get(phase);
    if (started === undefined) {
      skippedRecords.push(`phase ${phase} completed without a matching start record`);
      continue;
    }

    const durationMs = timestampMs - started.timestampMs;
    if (durationMs < 0) {
      skippedRecords.push(`phase ${phase} completed before its start record`);
      continue;
    }

    phaseTimings.push({
      completedAt: record.timestamp,
      durationMs,
      phase,
      startedAt: started.timestamp,
    });
    startedByPhase.delete(phase);
  }

  return {
    phaseTimings,
    skippedRecords,
  };
}

function diagnosticEventPrefix(record: SandboxStartupDiagnosticRecord): string {
  return `sandbox_${record.operationKind}`;
}

function parseStartupDiagnosticTimestampMs(timestamp: string): number | null {
  const parsedMs = Date.parse(timestamp);
  if (Number.isFinite(parsedMs)) {
    return parsedMs;
  }

  const highPrecisionTimestampMatch = /^(.+\.)(\d{3})\d+(Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  if (highPrecisionTimestampMatch === null) {
    return null;
  }

  const prefix = highPrecisionTimestampMatch[1];
  const milliseconds = highPrecisionTimestampMatch[2];
  const suffix = highPrecisionTimestampMatch[3];
  if (prefix === undefined || milliseconds === undefined || suffix === undefined) {
    return null;
  }

  const normalizedTimestamp = `${prefix}${milliseconds}${suffix}`;
  const normalizedMs = Date.parse(normalizedTimestamp);
  return Number.isFinite(normalizedMs) ? normalizedMs : null;
}

export function parseStartupDiagnostics(logText: string): {
  records: SandboxStartupDiagnosticRecord[];
  parseErrors: string[];
} {
  const records: SandboxStartupDiagnosticRecord[] = [];
  const parseErrors: string[] = [];

  for (const [index, line] of logText.split("\n").entries()) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) {
      continue;
    }

    const parsedJson = (() => {
      try {
        return JSON.parse(trimmedLine);
      } catch (error) {
        parseErrors.push(
          `line ${String(index + 1)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    })();
    if (parsedJson === null) {
      continue;
    }

    const parsedRecord = SandboxStartupDiagnosticRecordSchema.safeParse(parsedJson);
    if (!parsedRecord.success) {
      parseErrors.push(
        `line ${String(index + 1)} does not match startup diagnostic schema: ${parsedRecord.error.message}`,
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

export async function emitSandboxStartupDiagnosticPhaseTimings(input: {
  logger: MistleLogger;
  sandboxRuntimeControl: SandboxRuntimeControl;
  providerSandboxId: string;
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  operation: "activate";
  operationKind: SandboxStartupDiagnosticRecord["operationKind"];
}): Promise<void> {
  const baseAttributes = {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.provider_sandbox_id": input.providerSandboxId,
    "mistle.sandbox.runtime_provider": input.runtimeProvider,
    "mistle.sandbox.startup_operation": input.operation,
    ...(input.operationKind === undefined
      ? {}
      : { "mistle.sandbox.startup_operation_kind": input.operationKind }),
  };

  try {
    const logText = await input.sandboxRuntimeControl.readOperationLog({
      id: input.providerSandboxId,
      operation: input.operation,
    });

    if (logText === null) {
      input.logger.warn(
        baseAttributes,
        "Sandbox startup diagnostic phase timing log was not available.",
      );
      return;
    }

    const { records, parseErrors } = parseStartupDiagnostics(logText);
    const { phaseTimings, skippedRecords } = summarizeStartupDiagnosticPhaseTimings(records);

    for (const parseError of parseErrors) {
      input.logger.warn(
        {
          ...baseAttributes,
          parseError,
        },
        "Failed to parse sandbox startup diagnostic log line for phase timing.",
      );
    }

    for (const skippedRecord of skippedRecords) {
      input.logger.warn(
        {
          ...baseAttributes,
          skippedRecord,
        },
        "Skipped sandbox startup diagnostic phase timing record.",
      );
    }

    for (const phaseTiming of phaseTimings) {
      input.logger.info(
        {
          ...baseAttributes,
          "mistle.sandbox.startup_phase": phaseTiming.phase,
          "mistle.sandbox.startup_phase_duration_ms": phaseTiming.durationMs,
          "mistle.sandbox.startup_phase_started_at": phaseTiming.startedAt,
          "mistle.sandbox.startup_phase_completed_at": phaseTiming.completedAt,
        },
        "Sandbox startup diagnostic phase timing.",
      );
    }
  } catch (error) {
    input.logger.warn(
      {
        ...baseAttributes,
        err: error,
      },
      "Failed to collect sandbox startup diagnostic phase timings.",
    );
  }
}

export async function emitSandboxStartupDiagnostics(input: {
  logger: MistleLogger;
  sandboxRuntimeControl: SandboxRuntimeControl;
  providerSandboxId: string;
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  operation: "activate";
  operationKind: SandboxStartupDiagnosticRecord["operationKind"];
}): Promise<void> {
  const initialAttributes: Attributes = {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.provider_sandbox_id": input.providerSandboxId,
    "mistle.sandbox.runtime_provider": input.runtimeProvider,
    "mistle.sandbox.startup_operation": input.operation,
    ...(input.operationKind === undefined
      ? {}
      : { "mistle.sandbox.startup_operation_kind": input.operationKind }),
  };

  await StartupDiagnosticsTracer.startActiveSpan(
    `data_plane_worker.sandbox_${input.operation}_diagnostics`,
    {
      attributes: initialAttributes,
    },
    async (span: Span) => {
      try {
        const logText = await input.sandboxRuntimeControl.readOperationLog({
          id: input.providerSandboxId,
          operation: input.operation,
        });

        if (logText === null) {
          input.logger.warn(initialAttributes, "Sandbox startup diagnostic log was not available.");
          span.end();
          return;
        }

        const { records, parseErrors } = parseStartupDiagnostics(logText);

        for (const parseError of parseErrors) {
          input.logger.warn(
            {
              ...initialAttributes,
              parseError,
            },
            "Failed to parse sandbox startup diagnostic log line.",
          );
          span.addEvent("sandbox_startup_diagnostic_parse_failed", {
            ...initialAttributes,
            "mistle.sandbox.startup_diagnostic.parse_error": parseError,
          });
        }

        for (const record of records) {
          const diagnosticAttributes = toDiagnosticAttributes(record);
          if (record.level === "error") {
            input.logger.error(diagnosticAttributes, "Sandbox startup diagnostic event.");
          } else {
            input.logger.info(diagnosticAttributes, "Sandbox startup diagnostic event.");
          }
          span.addEvent(record.event, diagnosticAttributes);
        }

        if (records.some((record) => record.level === "error")) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Sandbox startup diagnostic log captured one or more error records.",
          });
        }
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message:
            error instanceof Error ? error.message : "Failed to emit sandbox startup diagnostics.",
        });
        input.logger.warn(
          {
            ...initialAttributes,
            err: error,
          },
          "Failed to collect sandbox startup diagnostics before cleanup.",
        );
      } finally {
        span.end();
      }
    },
  );
}
