import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePersistenceMode,
  type SandboxInstancePurpose,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import { isSandboxResourceNotFoundError } from "@mistle/sandbox";
import type { Clock } from "@mistle/time";
import type { SandboxStopReason } from "@mistle/workflow-registry/data-plane";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import {
  createResolveSandboxRuntimeInput,
  type SandboxRuntimeProviderResolver,
} from "../core/sandbox-runtime-resolver.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceStopped } from "./mark-sandbox-instance-stopped.js";

type RunningSandboxInstanceStopState = {
  organizationId: string;
  persistenceMode: SandboxInstancePersistenceMode;
  purpose: SandboxInstancePurpose;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxStorageMb: number | null;
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

function includeExpectedOwnerLeaseId(input: { expectedOwnerLeaseId: string | undefined }): {
  expectedOwnerLeaseId?: string;
} {
  return input.expectedOwnerLeaseId === undefined
    ? {}
    : { expectedOwnerLeaseId: input.expectedOwnerLeaseId };
}

/**
 * Returns `true` when the current runtime-state snapshot still permits the
 * requested fenced stop.
 */
export function shouldExecuteSandboxStop(input: {
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId?: string;
  snapshot: SandboxRuntimeStateSnapshot;
}): boolean {
  if (input.stopReason === "user") {
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
  tables: DataPlaneTables;
  sandboxInstanceId: string;
}): Promise<RunningSandboxInstanceStopState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      organizationId: true,
      persistenceMode: true,
      purpose: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxStorageMb: true,
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
    organizationId: sandboxInstance.organizationId,
    persistenceMode: sandboxInstance.persistenceMode,
    purpose: sandboxInstance.purpose,
    runtimeProvider: sandboxInstance.runtimeProvider,
    sandboxConnectionId: sandboxInstance.sandboxConnectionId,
    sandboxVcpuCount: sandboxInstance.sandboxVcpuCount,
    sandboxMemoryMb: sandboxInstance.sandboxMemoryMb,
    sandboxStorageMb: sandboxInstance.sandboxStorageMb,
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
  const snapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: ctx.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });

  return shouldExecuteSandboxStop({
    stopReason: ctx.stopReason,
    snapshot,
    ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: ctx.expectedOwnerLeaseId }),
  });
}

function assertUserStopIsScopedToSetupCheck(input: {
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  purpose: SandboxInstancePurpose;
}): void {
  if (input.stopReason !== "user") {
    return;
  }

  if (input.purpose !== SandboxInstancePurposes.SETUP_CHECK) {
    throw new Error(
      `User-requested stop is only supported for setup-check sandbox instances; sandbox instance '${input.sandboxInstanceId}' has purpose '${input.purpose}'.`,
    );
  }
}

export async function stopSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    tables: DataPlaneTables;
    controlPlaneInternalClient: ControlPlaneInternalClient;
    sandboxRuntimeProviderResolver: SandboxRuntimeProviderResolver;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input: {
    sandboxInstanceId: string;
    stopReason: SandboxStopReason;
    expectedOwnerLeaseId?: string;
  },
): Promise<StopSandboxInstanceResult> {
  if (
    !(await isSandboxStopStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: input.stopReason,
      ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
    }))
  ) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_load",
    };
  }

  const sandboxInstanceState = await resolveRunningSandboxInstanceStopState({
    db: ctx.db,
    tables: ctx.tables,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstanceState === null) {
    return {
      executed: false,
      outcome: "already_stopped",
    };
  }

  assertUserStopIsScopedToSetupCheck({
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    purpose: sandboxInstanceState.purpose,
  });

  if (
    !(await isSandboxStopStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: input.sandboxInstanceId,
      stopReason: input.stopReason,
      ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
    }))
  ) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_stop",
    };
  }

  const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(
    createResolveSandboxRuntimeInput(sandboxInstanceState),
  );

  try {
    await stopSandbox(
      {
        db: ctx.db,
        tables: ctx.tables,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        config: ctx.config,
        sandboxAdapter: resolvedRuntime.sandboxAdapter,
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
    tables: ctx.tables,
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    stillPermitted: async () =>
      isSandboxStopStillPermitted({
        runtimeStateReader: ctx.runtimeStateReader,
        clock: ctx.clock,
        sandboxInstanceId: input.sandboxInstanceId,
        stopReason: input.stopReason,
        ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
      }),
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
