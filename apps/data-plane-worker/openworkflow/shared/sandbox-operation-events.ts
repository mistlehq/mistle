import {
  insertSandboxOperationEvent,
  type DataPlaneDatabase,
  type SandboxLifecyclePhase,
  type SandboxLifecycleStatus,
  type SandboxOperationKind,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import type { Clock } from "@mistle/time";

import { recordSandboxOperationPhaseDuration } from "./sandbox-operation-telemetry.js";

export type WorkerSandboxLifecycleEventRecorder = {
  nowMs: () => number;
  operationKind: SandboxOperationKind;
  record: (input: {
    attributes?: Record<string, unknown>;
    message: string;
    phase: SandboxLifecyclePhase;
    status: SandboxLifecycleStatus;
  }) => Promise<void>;
};

export function createWorkerSandboxLifecycleEventRecorder(input: {
  clock: Clock;
  db: DataPlaneDatabase;
  logger: MistleLogger;
  operationId: string;
  operationKind: SandboxOperationKind;
  sandboxInstanceId: string;
}): WorkerSandboxLifecycleEventRecorder {
  return {
    nowMs: () => input.clock.nowMs(),
    operationKind: input.operationKind,
    record: async (event) => {
      try {
        await insertSandboxOperationEvent(input.db, {
          attributes: event.attributes ?? {},
          message: event.message,
          observedAt: input.clock.nowDate().toISOString(),
          operationId: input.operationId,
          operationKind: input.operationKind,
          payloadBytes: null,
          phase: event.phase,
          recordKind: "lifecycle",
          sandboxInstanceId: input.sandboxInstanceId,
          source: "worker",
          status: event.status,
          stream: null,
        });
      } catch (error) {
        input.logger.warn(
          {
            err: error,
            operationId: input.operationId,
            operationKind: input.operationKind,
            phase: event.phase,
            sandboxInstanceId: input.sandboxInstanceId,
            status: event.status,
          },
          "Failed to persist sandbox operation lifecycle event.",
        );
      }
    },
  };
}

export async function recordWorkerSandboxLifecyclePhase<Output>(
  recorder: WorkerSandboxLifecycleEventRecorder,
  input: {
    attributes?: Record<string, unknown>;
    completedMessage: string;
    failedMessage: string;
    phase: SandboxLifecyclePhase;
    startedMessage: string;
  },
  fn: () => Promise<Output> | Output,
): Promise<Output> {
  const startedAtMs = recorder.nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  await recorder.record({
    message: input.startedMessage,
    phase: input.phase,
    status: "started",
    ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
  });

  try {
    const output = await fn();
    const timingAttributes = createLifecyclePhaseTimingAttributes({
      completedAtMs: recorder.nowMs(),
      startedAtMs,
    });
    recordSandboxOperationPhaseDuration({
      durationMs: timingAttributes.durationMs,
      operationKind: recorder.operationKind,
      phase: input.phase,
      status: "completed",
      ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
    });
    await recorder.record({
      attributes: {
        ...(input.attributes ?? {}),
        ...timingAttributes,
        startedAt,
      },
      message: input.completedMessage,
      phase: input.phase,
      status: "completed",
    });
    return output;
  } catch (error) {
    const timingAttributes = createLifecyclePhaseTimingAttributes({
      completedAtMs: recorder.nowMs(),
      startedAtMs,
    });
    recordSandboxOperationPhaseDuration({
      durationMs: timingAttributes.durationMs,
      operationKind: recorder.operationKind,
      phase: input.phase,
      status: "failed",
      ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
    });
    await recorder.record({
      attributes: {
        ...(input.attributes ?? {}),
        error: formatLifecycleEventError(error),
        ...timingAttributes,
        startedAt,
      },
      message: input.failedMessage,
      phase: input.phase,
      status: "failed",
    });
    throw error;
  }
}

export async function recordWorkerSandboxLifecycleBooleanPhase(
  recorder: WorkerSandboxLifecycleEventRecorder,
  input: {
    attributes?: Record<string, unknown>;
    completedMessage: string;
    erroredMessage: string;
    failedAttributes?: Record<string, unknown>;
    failedMessage: string;
    phase: SandboxLifecyclePhase;
    startedMessage: string;
  },
  fn: () => Promise<boolean> | boolean,
): Promise<boolean> {
  const startedAtMs = recorder.nowMs();
  const startedAt = new Date(startedAtMs).toISOString();
  await recorder.record({
    message: input.startedMessage,
    phase: input.phase,
    status: "started",
    ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
  });

  try {
    const output = await fn();
    const status = output ? "completed" : "failed";
    const timingAttributes = createLifecyclePhaseTimingAttributes({
      completedAtMs: recorder.nowMs(),
      startedAtMs,
    });
    recordSandboxOperationPhaseDuration({
      durationMs: timingAttributes.durationMs,
      operationKind: recorder.operationKind,
      phase: input.phase,
      status,
      ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
    });
    await recorder.record({
      attributes: {
        ...(input.attributes ?? {}),
        ...(output ? {} : (input.failedAttributes ?? {})),
        ...timingAttributes,
        startedAt,
      },
      message: output ? input.completedMessage : input.failedMessage,
      phase: input.phase,
      status,
    });
    return output;
  } catch (error) {
    const timingAttributes = createLifecyclePhaseTimingAttributes({
      completedAtMs: recorder.nowMs(),
      startedAtMs,
    });
    recordSandboxOperationPhaseDuration({
      durationMs: timingAttributes.durationMs,
      operationKind: recorder.operationKind,
      phase: input.phase,
      status: "failed",
      ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
    });
    await recorder.record({
      attributes: {
        ...(input.attributes ?? {}),
        error: formatLifecycleEventError(error),
        ...timingAttributes,
        startedAt,
      },
      message: input.erroredMessage,
      phase: input.phase,
      status: "failed",
    });
    throw error;
  }
}

export function createLifecyclePhaseTimingAttributes(input: {
  completedAtMs: number;
  startedAtMs: number;
}): {
  completedAt: string;
  durationMs: number;
} {
  if (input.completedAtMs < input.startedAtMs) {
    throw new Error("Sandbox lifecycle phase completed before it started.");
  }

  return {
    completedAt: new Date(input.completedAtMs).toISOString(),
    durationMs: input.completedAtMs - input.startedAtMs,
  };
}

function formatLifecycleEventError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
