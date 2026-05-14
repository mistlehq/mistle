import {
  insertSandboxOperationEvent,
  type DataPlaneDatabase,
  type SandboxLifecyclePhase,
  type SandboxLifecycleStatus,
  type SandboxOperationKind,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import type { Clock } from "@mistle/time";

export type WorkerSandboxLifecycleEventRecorder = {
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
  await recorder.record({
    message: input.startedMessage,
    phase: input.phase,
    status: "started",
    ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
  });

  try {
    const output = await fn();
    await recorder.record({
      message: input.completedMessage,
      phase: input.phase,
      status: "completed",
      ...(input.attributes === undefined ? {} : { attributes: input.attributes }),
    });
    return output;
  } catch (error) {
    await recorder.record({
      attributes: {
        ...(input.attributes ?? {}),
        error: formatLifecycleEventError(error),
      },
      message: input.failedMessage,
      phase: input.phase,
      status: "failed",
    });
    throw error;
  }
}

function formatLifecycleEventError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
