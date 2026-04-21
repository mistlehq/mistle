import type { SandboxInstancePersistenceMode } from "@mistle/db/data-plane";
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
    operation: z.enum(["init", "resume"]),
    phase: z.string().optional(),
  })
  .catchall(z.unknown());

export type SandboxStartupDiagnosticRecord = z.output<typeof SandboxStartupDiagnosticRecordSchema>;

export function toDiagnosticAttributes(record: SandboxStartupDiagnosticRecord): Attributes {
  const attributes: Attributes = {
    "mistle.sandbox.instance_id": record.sandboxInstanceId,
    "mistle.sandbox.startup_operation": record.operation,
    "mistle.sandbox.startup_event": record.event,
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

export async function emitSandboxStartupDiagnostics(input: {
  logger: MistleLogger;
  sandboxRuntimeControl: SandboxRuntimeControl;
  providerSandboxId: string;
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  operation: "init" | "resume";
  persistenceMode?: SandboxInstancePersistenceMode;
}): Promise<void> {
  const initialAttributes: Attributes = {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.provider_sandbox_id": input.providerSandboxId,
    "mistle.sandbox.runtime_provider": input.runtimeProvider,
    "mistle.sandbox.startup_operation": input.operation,
    ...(input.persistenceMode === undefined
      ? {}
      : {
          "mistle.sandbox.persistence_mode": input.persistenceMode,
        }),
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
