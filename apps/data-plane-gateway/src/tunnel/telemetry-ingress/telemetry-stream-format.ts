import type { TelemetryFormat, TelemetrySignal } from "@mistle/sandbox-session-protocol";

export const SandboxTelemetryLogFormat = "mistle.sandbox-runtime.log.v1";
export const SandboxTelemetryTraceJsonFormat = "otlp.http.traces.v1+json";

const SupportedFormatsBySignal: Record<TelemetrySignal, readonly TelemetryFormat[]> = {
  logs: [SandboxTelemetryLogFormat],
  traces: [SandboxTelemetryTraceJsonFormat],
};

export function isSupportedTelemetryStream(input: {
  format: TelemetryFormat;
  signal: TelemetrySignal;
}): boolean {
  return SupportedFormatsBySignal[input.signal].includes(input.format);
}

export function getTelemetryContentType(input: {
  format: TelemetryFormat;
  signal: TelemetrySignal;
}): string | undefined {
  if (!isSupportedTelemetryStream(input)) {
    return undefined;
  }

  if (input.signal === "logs") {
    return undefined;
  }

  if (input.format === SandboxTelemetryTraceJsonFormat) {
    return "application/json";
  }
  return undefined;
}
