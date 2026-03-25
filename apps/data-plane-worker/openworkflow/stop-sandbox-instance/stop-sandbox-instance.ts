import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import type { Clock } from "@mistle/time";
import type { SandboxStopReason } from "@mistle/workflow-registry/data-plane";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceStopped } from "./mark-sandbox-instance-stopped.js";

type RunningSandboxInstanceStopState = {
  runtimeProvider: SandboxInstanceProvider;
  providerSandboxId: string;
};

/**
 * Returns `true` when the current runtime-state snapshot still permits the
 * requested fenced stop.
 */
export function shouldExecuteSandboxStop(input: {
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId: string;
  snapshot: SandboxRuntimeStateSnapshot;
}): boolean {
  if (input.stopReason === "idle") {
    return (
      input.snapshot.ownerLeaseId === input.expectedOwnerLeaseId &&
      input.snapshot.attachment?.ownerLeaseId === input.expectedOwnerLeaseId
    );
  }

  if (
    input.snapshot.attachment?.ownerLeaseId !== undefined &&
    input.snapshot.attachment.ownerLeaseId !== input.expectedOwnerLeaseId
  ) {
    return false;
  }

  if (
    input.snapshot.ownerLeaseId !== null &&
    input.snapshot.ownerLeaseId !== input.expectedOwnerLeaseId
  ) {
    return false;
  }

  return (
    input.snapshot.attachment === null &&
    (input.snapshot.ownerLeaseId === null ||
      input.snapshot.ownerLeaseId === input.expectedOwnerLeaseId)
  );
}

async function resolveRunningSandboxInstanceStopState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<RunningSandboxInstanceStopState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      runtimeProvider: true,
      providerSandboxId: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }

  if (sandboxInstance.status === SandboxInstanceStatuses.STOPPED) {
    return null;
  }

  if (sandboxInstance.status !== SandboxInstanceStatuses.RUNNING) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be running or stopped before stop execution.`,
    );
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected running sandbox instance '${input.sandboxInstanceId}' to have a providerSandboxId.`,
    );
  }

  return {
    runtimeProvider: sandboxInstance.runtimeProvider,
    providerSandboxId: sandboxInstance.providerSandboxId,
  };
}

export async function stopSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input: {
    sandboxInstanceId: string;
    stopReason: SandboxStopReason;
    expectedOwnerLeaseId: string;
  },
): Promise<void> {
  const snapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: input.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });
  if (
    !shouldExecuteSandboxStop({
      stopReason: input.stopReason,
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
      snapshot,
    })
  ) {
    return;
  }

  const sandboxInstanceState = await resolveRunningSandboxInstanceStopState({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstanceState === null) {
    return;
  }

  try {
    await stopSandbox(
      {
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
      },
      {
        runtimeProvider: sandboxInstanceState.runtimeProvider,
        providerSandboxId: sandboxInstanceState.providerSandboxId,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }
  }

  await markSandboxInstanceStopped({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
  });
}
