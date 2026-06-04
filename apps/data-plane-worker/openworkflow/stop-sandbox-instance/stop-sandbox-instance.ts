import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstancePurpose,
  type SandboxInstanceProvider,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import { isSandboxResourceNotFoundError, type SandboxAdapter } from "@mistle/sandbox";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
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
import { markSandboxInstanceFailed } from "../reconcile-sandbox-instance/mark-sandbox-instance-failed.js";
import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceStopped } from "./mark-sandbox-instance-stopped.js";
import {
  determineStopProviderAction,
  type StopProviderAction,
  type StopProviderState,
} from "./stop-provider-policy.js";

type StoppableSandboxInstanceStopState = {
  organizationId: string;
  purpose: SandboxInstancePurpose;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
  providerSandboxId: string;
  computeGeneration: number;
  status: SandboxInstanceStatus;
};

export type BootstrapAttachmentTerminationTarget = {
  expectedOwnerLeaseId: string;
  expectedSessionId: string;
};

export type StopSandboxInstanceOutcome =
  | "stopped"
  | "failed"
  | "already_stopped"
  | "runtime_state_fence_before_load"
  | "runtime_state_fence_before_stop"
  | "runtime_state_fence_before_mark";

export type StopSandboxInstanceResult = {
  executed: boolean;
  outcome: StopSandboxInstanceOutcome;
  bootstrapAttachmentTerminationTarget?: BootstrapAttachmentTerminationTarget;
  terminalFailure?: {
    failureCode: string;
    failureMessage: string;
  };
  usageEventState?: {
    organizationId: string;
    runtimeProvider: SandboxInstanceProvider;
    providerSandboxId: string;
    computeGeneration: number;
    vcpuCount: number | null;
    memoryMb: number | null;
    diskMb: number | null;
  };
};

type StopSandboxInstanceUsageEventState = NonNullable<StopSandboxInstanceResult["usageEventState"]>;

function createStopSandboxUsageEventState(
  state: StoppableSandboxInstanceStopState,
): StopSandboxInstanceUsageEventState {
  return {
    organizationId: state.organizationId,
    runtimeProvider: state.runtimeProvider,
    providerSandboxId: state.providerSandboxId,
    computeGeneration: state.computeGeneration,
    vcpuCount: state.sandboxVcpuCount,
    memoryMb: state.sandboxMemoryMb,
    diskMb: state.sandboxDiskMb,
  };
}

function includeExpectedOwnerLeaseId(input: { expectedOwnerLeaseId: string | undefined }): {
  expectedOwnerLeaseId?: string;
} {
  return input.expectedOwnerLeaseId === undefined
    ? {}
    : { expectedOwnerLeaseId: input.expectedOwnerLeaseId };
}

function throwStopProviderRetry(
  action: Extract<StopProviderAction, { kind: "retry_provider_stop_in_progress" }>,
): never {
  throw new Error(action.reason);
}

async function inspectStopProviderStateOrMissing(ctx: {
  sandboxAdapter: SandboxAdapter;
  providerSandboxId: string;
}): Promise<StopProviderState> {
  try {
    const inspection = await ctx.sandboxAdapter.inspect({
      id: ctx.providerSandboxId,
    });

    return inspection.disposition;
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    return "missing";
  }
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

async function resolveStoppableSandboxInstanceStopState(input: {
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  sandboxInstanceId: string;
}): Promise<StoppableSandboxInstanceStopState | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      organizationId: true,
      purpose: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxDiskMb: true,
      providerSandboxId: true,
      computeGeneration: true,
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

  if (
    sandboxInstance.status !== SandboxInstanceStatuses.RUNNING &&
    sandboxInstance.status !== SandboxInstanceStatuses.RECONNECTING &&
    sandboxInstance.status !== SandboxInstanceStatuses.STOPPING
  ) {
    throw new Error(
      `Expected sandbox instance '${input.sandboxInstanceId}' to be running, reconnecting, stopping, or stopped before stop execution.`,
    );
  }

  if (sandboxInstance.providerSandboxId === null) {
    throw new Error(
      `Expected ${sandboxInstance.status} sandbox instance '${input.sandboxInstanceId}' to have a providerSandboxId.`,
    );
  }

  return {
    organizationId: sandboxInstance.organizationId,
    purpose: sandboxInstance.purpose,
    runtimeProvider: sandboxInstance.runtimeProvider,
    sandboxConnectionId: sandboxInstance.sandboxConnectionId,
    sandboxVcpuCount: sandboxInstance.sandboxVcpuCount,
    sandboxMemoryMb: sandboxInstance.sandboxMemoryMb,
    sandboxDiskMb: sandboxInstance.sandboxDiskMb,
    providerSandboxId: sandboxInstance.providerSandboxId,
    computeGeneration: sandboxInstance.computeGeneration,
    status: sandboxInstance.status,
  };
}

async function markStopProviderFailureOrThrow(
  ctx: {
    db: DataPlaneDatabase;
    tables: DataPlaneTables;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input: {
    sandboxInstanceId: string;
    currentStatus: SandboxInstanceStatus;
    stopReason: SandboxStopReason;
    expectedOwnerLeaseId?: string;
    action: Extract<StopProviderAction, { kind: "fail" }>;
    usageEventState: StopSandboxInstanceUsageEventState;
  },
): Promise<StopSandboxInstanceResult> {
  const markOutcome = await markSandboxInstanceFailed({
    db: ctx.db,
    tables: ctx.tables,
    sandboxInstanceId: input.sandboxInstanceId,
    currentStatus: input.currentStatus,
    failureCode: input.action.failureCode,
    failureMessage: input.action.failureMessage,
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

  return {
    executed: markOutcome === "failed",
    outcome: "failed",
    terminalFailure: {
      failureCode: input.action.failureCode,
      failureMessage: input.action.failureMessage,
    },
    ...(markOutcome === "failed" ? { usageEventState: input.usageEventState } : {}),
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

function resolveBootstrapAttachmentTerminationTarget(
  snapshot: SandboxRuntimeStateSnapshot,
): BootstrapAttachmentTerminationTarget | undefined {
  if (snapshot.attachment === null) {
    return undefined;
  }

  return {
    expectedOwnerLeaseId: snapshot.attachment.ownerLeaseId,
    expectedSessionId: snapshot.attachment.sessionId,
  };
}

async function readSandboxStopPermission(ctx: {
  runtimeStateReader: SandboxRuntimeStateReader;
  clock: Clock;
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  expectedOwnerLeaseId?: string;
}): Promise<{
  permitted: boolean;
  snapshot: SandboxRuntimeStateSnapshot;
}> {
  const snapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: ctx.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });

  return {
    permitted: shouldExecuteSandboxStop({
      stopReason: ctx.stopReason,
      snapshot,
      ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: ctx.expectedOwnerLeaseId }),
    }),
    snapshot,
  };
}

export function isWorkflowUserStopReasonSupportedPurpose(purpose: SandboxInstancePurpose): boolean {
  return (
    purpose === SandboxInstancePurposes.SESSION ||
    purpose === SandboxInstancePurposes.SETUP_ASSISTANT ||
    purpose === SandboxInstancePurposes.SETUP_CHECK ||
    purpose === SandboxInstancePurposes.SKILLS_DISCOVERY
  );
}

function assertWorkflowUserStopReasonIsScopedToSupportedPurpose(input: {
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  purpose: SandboxInstancePurpose;
}): void {
  if (input.stopReason !== "user") {
    return;
  }

  if (!isWorkflowUserStopReasonSupportedPurpose(input.purpose)) {
    throw new Error(
      `Workflow stop reason 'user' is only supported for session, setup-check, and setup-assistant sandbox instances; sandbox instance '${input.sandboxInstanceId}' has purpose '${input.purpose}'.`,
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
    logger?: MistleLogger | undefined;
  },
  input: {
    sandboxInstanceId: string;
    stopReason: SandboxStopReason;
    expectedOwnerLeaseId?: string;
  },
): Promise<StopSandboxInstanceResult> {
  const initialPermission = await readSandboxStopPermission({
    runtimeStateReader: ctx.runtimeStateReader,
    clock: ctx.clock,
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
  });
  if (!initialPermission.permitted) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_load",
    };
  }
  let bootstrapAttachmentTerminationTarget = resolveBootstrapAttachmentTerminationTarget(
    initialPermission.snapshot,
  );

  const sandboxInstanceState = await resolveStoppableSandboxInstanceStopState({
    db: ctx.db,
    tables: ctx.tables,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstanceState === null) {
    return {
      executed: false,
      outcome: "already_stopped",
      ...(bootstrapAttachmentTerminationTarget === undefined
        ? {}
        : { bootstrapAttachmentTerminationTarget }),
    };
  }

  assertWorkflowUserStopReasonIsScopedToSupportedPurpose({
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    purpose: sandboxInstanceState.purpose,
  });

  const beforeStopPermission = await readSandboxStopPermission({
    runtimeStateReader: ctx.runtimeStateReader,
    clock: ctx.clock,
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
  });
  if (!beforeStopPermission.permitted) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_stop",
    };
  }
  bootstrapAttachmentTerminationTarget = resolveBootstrapAttachmentTerminationTarget(
    beforeStopPermission.snapshot,
  );

  const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(
    createResolveSandboxRuntimeInput(sandboxInstanceState),
  );
  const initialProviderState = await inspectStopProviderStateOrMissing({
    sandboxAdapter: resolvedRuntime.sandboxAdapter,
    providerSandboxId: sandboxInstanceState.providerSandboxId,
  });
  const initialProviderAction = determineStopProviderAction({
    providerState: initialProviderState,
  });
  switch (initialProviderAction.kind) {
    case "fail":
      return await markStopProviderFailureOrThrow(ctx, {
        sandboxInstanceId: input.sandboxInstanceId,
        currentStatus: sandboxInstanceState.status,
        stopReason: input.stopReason,
        ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
        action: initialProviderAction,
        usageEventState: createStopSandboxUsageEventState(sandboxInstanceState),
      });
    case "retry_provider_stop_in_progress":
      throwStopProviderRetry(initialProviderAction);
    case "mark_stopped":
    case "shutdown_stop_then_inspect":
      break;
  }

  const beforeMarkPermission = await readSandboxStopPermission({
    runtimeStateReader: ctx.runtimeStateReader,
    clock: ctx.clock,
    sandboxInstanceId: input.sandboxInstanceId,
    stopReason: input.stopReason,
    ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
  });
  if (!beforeMarkPermission.permitted) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_mark",
    };
  }
  const stopRequestedStatus = await applySandboxLifecycleEvent(
    {
      db: ctx.db,
      logger: ctx.logger,
      tables: ctx.tables,
    },
    {
      sandboxInstanceId: input.sandboxInstanceId,
      event: SandboxLifecycleEvents.STOP_REQUESTED,
    },
  );

  if (initialProviderAction.kind === "shutdown_stop_then_inspect") {
    try {
      await stopSandbox(
        {
          sandboxAdapter: resolvedRuntime.sandboxAdapter,
          sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
        },
        {
          runtimeProvider: sandboxInstanceState.runtimeProvider,
          providerSandboxId: sandboxInstanceState.providerSandboxId,
          sandboxInstanceId: input.sandboxInstanceId,
        },
      );
    } catch (error) {
      if (!isSandboxResourceNotFoundError(error)) {
        throw error;
      }

      return await markStopProviderFailureOrThrow(ctx, {
        sandboxInstanceId: input.sandboxInstanceId,
        currentStatus: stopRequestedStatus,
        stopReason: input.stopReason,
        ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
        usageEventState: createStopSandboxUsageEventState(sandboxInstanceState),
        action: {
          kind: "fail",
          failureCode: "provider_runtime_missing",
          failureMessage: "Sandbox runtime was not found at the provider during sandbox stop.",
        },
      });
    }

    const afterStopProviderState = await inspectStopProviderStateOrMissing({
      sandboxAdapter: resolvedRuntime.sandboxAdapter,
      providerSandboxId: sandboxInstanceState.providerSandboxId,
    });
    const afterStopProviderAction = determineStopProviderAction({
      providerState: afterStopProviderState,
    });
    switch (afterStopProviderAction.kind) {
      case "fail":
        return await markStopProviderFailureOrThrow(ctx, {
          sandboxInstanceId: input.sandboxInstanceId,
          currentStatus: stopRequestedStatus,
          stopReason: input.stopReason,
          ...includeExpectedOwnerLeaseId({ expectedOwnerLeaseId: input.expectedOwnerLeaseId }),
          action: afterStopProviderAction,
          usageEventState: createStopSandboxUsageEventState(sandboxInstanceState),
        });
      case "retry_provider_stop_in_progress":
        throwStopProviderRetry(afterStopProviderAction);
      case "shutdown_stop_then_inspect":
        throw new Error("Sandbox runtime remained active at the provider after provider stop.");
      case "mark_stopped":
        break;
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
      ...(bootstrapAttachmentTerminationTarget === undefined
        ? {}
        : { bootstrapAttachmentTerminationTarget }),
    };
  }

  return {
    executed: true,
    outcome: "stopped",
    usageEventState: createStopSandboxUsageEventState(sandboxInstanceState),
    ...(bootstrapAttachmentTerminationTarget === undefined
      ? {}
      : { bootstrapAttachmentTerminationTarget }),
  };
}
