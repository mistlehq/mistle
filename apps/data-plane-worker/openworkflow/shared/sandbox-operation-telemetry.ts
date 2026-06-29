import type { SandboxLifecyclePhase, SandboxLifecycleStatus } from "@mistle/db/data-plane";
import { metrics, type Attributes } from "@opentelemetry/api";

const SandboxOperationMeter = metrics.getMeter("@mistle/data-plane-worker/sandbox-operation");

const SandboxOperationPhaseDurationMs = SandboxOperationMeter.createHistogram(
  "mistle.sandbox.operation.phase.duration",
  {
    description: "Duration of persisted sandbox operation lifecycle phases.",
    unit: "ms",
  },
);

export function recordSandboxOperationPhaseDuration(input: {
  attributes?: Record<string, unknown>;
  durationMs: number;
  operationKind: string;
  phase: SandboxLifecyclePhase;
  status: Extract<SandboxLifecycleStatus, "completed" | "failed">;
}): void {
  SandboxOperationPhaseDurationMs.record(input.durationMs, {
    "mistle.sandbox.operation.kind": input.operationKind,
    "mistle.sandbox.operation.phase": input.phase,
    "mistle.sandbox.operation.phase.status": input.status,
    ...runtimeProviderMetricAttributes(input.attributes),
  });
}

function runtimeProviderMetricAttributes(
  attributes: Record<string, unknown> | undefined,
): Attributes {
  const runtimeProvider =
    attributes === undefined ? undefined : readStringAttribute(attributes, "runtimeProvider");
  if (runtimeProvider === undefined) {
    return {};
  }

  return {
    "mistle.sandbox.runtime_provider": runtimeProvider,
  };
}

function readStringAttribute(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
