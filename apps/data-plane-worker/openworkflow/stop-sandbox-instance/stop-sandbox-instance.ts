import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type SandboxInstancePurpose,
  type SandboxInstancePersistenceMode,
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
  persistenceMode: SandboxInstancePersistenceMode;
  purpose: SandboxInstancePurpose;
  runtimeProvider: SandboxInstanceProvider;
  providerSandboxId: string;
};

export type StopSandboxInstanceOutcome =
  | "stopped"
  | "already_stopped"
  | "runtime_state_fence_before_load"
  | "runtime_state_fence_before_stop"
  | "runtime_state_fence_before_mark";

export type StopSandboxInstanceResult = {
  executed: boolean;
  outcome: StopSandboxInstanceOutcome;
};

/**
 * Returns `true` when the current runtime-state snapshot still permits the
 * requested fenced stop.
 */
export function shouldExecuteSandboxStop(input: {
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId?: string;
  snapshot: SandboxRuntimeStateSnapshot;
}): boolean {
  if (input.stopReason === "system") {
    return true;
  }

  if (input.expectedOwnerLeaseId === undefined) {
    return false;
  }

  return (
    input.stopReason === "idle" &&
    input.snapshot.ownerLeaseId === input.expectedOwnerLeaseId &&
    input.snapshot.attachment?.ownerLeaseId === input.expectedOwnerLeaseId
  );
}

async function resolveRunningSandboxInstanceStopState(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<RunningSandboxInstanceStopState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      persistenceMode: true,
      purpose: true,
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
    persistenceMode: sandboxInstance.persistenceMode,
    purpose: sandboxInstance.purpose,
    runtimeProvider: sandboxInstance.runtimeProvider,
    providerSandboxId: sandboxInstance.providerSandboxId,
  };
}

async function isSandboxStopStillPermitted(ctx: {
  runtimeStateReader: SandboxRuntimeStateReader;
  clock: Clock;
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId?: string;
}): Promise<boolean> {
  if (ctx.stopReason === "system") {
    return true;
  }

  if (ctx.expectedOwnerLeaseId === undefined) {
    throw new Error("Expected owner lease id is required for idle sandbox stops.");
  }

  const snapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: ctx.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });

  return shouldExecuteSandboxStop({
    stopReason: ctx.stopReason,
    expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
    snapshot,
  });
}

export async function stopSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    sandboxAdapter: SandboxAdapter;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input:
    | {
        sandboxInstanceId: string;
        stopReason: "idle";
        expectedOwnerLeaseId: string;
      }
    | {
        sandboxInstanceId: string;
        stopReason: "system";
      },
): Promise<StopSandboxInstanceResult> {
  const permissionInput =
    input.stopReason === "idle"
      ? {
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          sandboxInstanceId: input.sandboxInstanceId,
          stopReason: input.stopReason,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        }
      : {
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          sandboxInstanceId: input.sandboxInstanceId,
          stopReason: input.stopReason,
        };

  if (!(await isSandboxStopStillPermitted(permissionInput))) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_load",
    };
  }

  const sandboxInstanceState = await resolveRunningSandboxInstanceStopState({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstanceState === null) {
    return {
      executed: false,
      outcome: "already_stopped",
    };
  }

  if (
    input.stopReason === "system" &&
    sandboxInstanceState.purpose !== SandboxInstancePurposes.SETUP_CHECK
  ) {
    throw new Error(
      `System stop is only supported for setup-check sandbox instances. Sandbox instance '${input.sandboxInstanceId}' has purpose '${sandboxInstanceState.purpose}'.`,
    );
  }

  if (!(await isSandboxStopStillPermitted(permissionInput))) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_stop",
    };
  }

  try {
    await stopSandbox(
      {
        db: ctx.db,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
        persistenceMode: sandboxInstanceState.persistenceMode,
        runtimeProvider: sandboxInstanceState.runtimeProvider,
        providerSandboxId: sandboxInstanceState.providerSandboxId,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }
  }

  const markOutcome = await markSandboxInstanceStopped({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    stillPermitted: async () => isSandboxStopStillPermitted(permissionInput),
  });

  if (markOutcome === "fence_mismatch") {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_mark",
    };
  }

  if (markOutcome === "already_stopped") {
    return {
      executed: false,
      outcome: "already_stopped",
    };
  }

  return {
    executed: true,
    outcome: "stopped",
  };
}
