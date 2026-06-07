import { systemClock } from "@mistle/time";
import { metrics, type Attributes } from "@opentelemetry/api";

export type SandboxProviderTelemetryName = "e2b" | "freestyle" | "tensorlake";

export type SandboxProviderOperationOutcome = "success" | "error";

export type SandboxDaemonReadyOutcome = "success" | "timeout" | "daemon_exited" | "provider_error";

const SandboxProviderMeter = metrics.getMeter("@mistle/sandbox/provider");

const SandboxProviderOperationDurationMs = SandboxProviderMeter.createHistogram(
  "mistle.sandbox.provider.operation.duration",
  {
    description: "Duration of sandbox provider and runtime-control operations.",
    unit: "ms",
  },
);

const SandboxDaemonReadyDurationMs = SandboxProviderMeter.createHistogram(
  "mistle.sandbox.daemon_ready.duration",
  {
    description: "Duration spent ensuring sandboxd is accepting control-socket requests.",
    unit: "ms",
  },
);

const SandboxDaemonReadyPollAttempts = SandboxProviderMeter.createHistogram(
  "mistle.sandbox.daemon_ready.poll_attempts",
  {
    description: "Readiness probe attempts while waiting for sandboxd to become ready.",
    unit: "1",
  },
);

const SandboxDaemonReadyStarted = SandboxProviderMeter.createCounter(
  "mistle.sandbox.daemon_ready.started.count",
  {
    description: "Count of ensure-daemon-ready calls that had to start sandboxd.",
  },
);

const SandboxDaemonReadyAlreadyReady = SandboxProviderMeter.createCounter(
  "mistle.sandbox.daemon_ready.already_ready.count",
  {
    description: "Count of ensure-daemon-ready calls where sandboxd was already ready.",
  },
);

export async function withSandboxProviderOperationTelemetry<Output>(input: {
  provider: SandboxProviderTelemetryName;
  operation: string;
  fn: () => Promise<Output>;
}): Promise<Output> {
  const startedAtMs = systemClock.nowMs();
  try {
    const output = await input.fn();
    recordSandboxProviderOperationDuration({
      durationMs: systemClock.nowMs() - startedAtMs,
      operation: input.operation,
      outcome: "success",
      provider: input.provider,
    });
    return output;
  } catch (error) {
    recordSandboxProviderOperationDuration({
      durationMs: systemClock.nowMs() - startedAtMs,
      errorCode: sandboxTelemetryErrorCode(error),
      operation: input.operation,
      outcome: "error",
      provider: input.provider,
    });
    throw error;
  }
}

export function recordSandboxProviderOperationDuration(input: {
  provider: SandboxProviderTelemetryName;
  operation: string;
  outcome: SandboxProviderOperationOutcome;
  durationMs: number;
  errorCode?: string;
}): void {
  SandboxProviderOperationDurationMs.record(input.durationMs, {
    "mistle.sandbox.provider": input.provider,
    "mistle.sandbox.provider.operation": input.operation,
    "mistle.sandbox.provider.operation.outcome": input.outcome,
    ...(input.errorCode === undefined
      ? {}
      : { "mistle.sandbox.provider.operation.error_code": input.errorCode }),
  });
}

export function recordSandboxDaemonReady(input: {
  provider: SandboxProviderTelemetryName;
  outcome: SandboxDaemonReadyOutcome;
  durationMs: number;
  pollAttempts: number;
  startedDaemon: boolean;
  alreadyReady: boolean;
  errorCode?: string;
}): void {
  const attributes: Attributes = {
    "mistle.sandbox.provider": input.provider,
    "mistle.sandbox.daemon_ready.outcome": input.outcome,
    "mistle.sandbox.daemon_ready.started_daemon": input.startedDaemon,
    "mistle.sandbox.daemon_ready.already_ready": input.alreadyReady,
    ...(input.errorCode === undefined
      ? {}
      : { "mistle.sandbox.daemon_ready.error_code": input.errorCode }),
  };

  SandboxDaemonReadyDurationMs.record(input.durationMs, attributes);
  SandboxDaemonReadyPollAttempts.record(input.pollAttempts, attributes);

  if (input.startedDaemon) {
    SandboxDaemonReadyStarted.add(1, attributes);
  }
  if (input.alreadyReady) {
    SandboxDaemonReadyAlreadyReady.add(1, attributes);
  }
}

export function sandboxTelemetryErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error.code;
  }

  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return typeof error;
}
