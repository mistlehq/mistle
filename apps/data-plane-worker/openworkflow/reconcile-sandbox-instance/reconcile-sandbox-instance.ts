import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import {
  isSandboxResourceNotFoundError,
  type SandboxAdapter,
  type SandboxInspectDisposition,
  type SandboxRuntimeControl,
} from "@mistle/sandbox";
import {
  isSandboxDisconnectReconciliationCandidate,
  SandboxLifecycleEvents,
} from "@mistle/sandbox-lifecycle";
import type { Clock } from "@mistle/time";
import type { SandboxReconcileReason } from "@mistle/workflow-registry/data-plane";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import {
  createResolveSandboxRuntimeInput,
  type SandboxRuntimeProviderResolver,
} from "../core/sandbox-runtime-resolver.js";
import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { determineDisconnectReconciliationAction } from "./disconnect-reconciliation-policy.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped } from "./mark-sandbox-instance-stopped.js";
import {
  formatStartupDisconnectFailureMessage,
  resolveLatestStartupEventSummary,
  resolveStartupFailureEvidence,
  shouldEnrichStartupDisconnectFailure,
  type StartupEventSummary,
  type StartupFailureEvidence,
} from "./startup-failure-evidence.js";

type ActiveSandboxInstance = {
  id: string;
  organizationId: string;
  computeGeneration: number;
  runtimeProvider: SandboxInstanceProvider;
  sandboxConnectionId: string | null;
  sandboxVcpuCount: number | null;
  sandboxMemoryMb: number | null;
  sandboxDiskMb: number | null;
  providerSandboxId: string;
  status: SandboxInstanceStatus;
};

type ProviderInspectionSummary = {
  disposition: SandboxInspectDisposition | "missing";
  providerStatus?: string;
};

export type ReconcileSandboxInstanceOutcome =
  | "failed"
  | "stopped"
  | "already_failed"
  | "already_stopped"
  | "already_terminal"
  | "runtime_state_fence_before_load"
  | "runtime_state_fence_before_inspect"
  | "runtime_state_fence_before_stop"
  | "runtime_state_fence_before_mark";

export type ReconcileBootstrapAttachmentTerminationTarget = {
  expectedOwnerLeaseId: string;
  expectedSessionId?: string;
};

export type ReconcileSandboxUsageEventState = {
  organizationId: string;
  runtimeProvider: SandboxInstanceProvider;
  providerSandboxId: string;
  computeGeneration: number;
  vcpuCount: number | null;
  memoryMb: number | null;
  diskMb: number | null;
};

export type ReconcileSandboxInstanceResult = {
  executed: boolean;
  outcome: ReconcileSandboxInstanceOutcome;
  bootstrapAttachmentTerminationTarget?: ReconcileBootstrapAttachmentTerminationTarget;
  diagnostics?: ReconcileSandboxInstanceDiagnostics;
  usageEventState?: ReconcileSandboxUsageEventState;
};

export type SandboxRuntimeStateDiagnostics = {
  ownerLeaseId: string | null;
  attachmentOwnerLeaseId: string | null;
  attachmentSessionId: string | null;
  attachmentNodeId: string | null;
  presenceActiveCount: number;
  keepaliveActive: boolean;
  runtimeReady: boolean;
};

export type ReconcileSandboxInstanceDiagnostics = {
  failureCode: string;
  providerState: SandboxInspectDisposition | "missing";
  providerStatus?: string;
  sandboxStatus: ActiveSandboxInstance["status"];
  runtimeProvider: SandboxInstanceProvider;
  providerSandboxId: string;
  expectedOwnerLeaseId: string;
  initialRuntimeState: SandboxRuntimeStateDiagnostics;
  startupFailureEvidence: StartupFailureEvidence | null;
  latestStartupEvent: StartupEventSummary | null;
};

type ReconciliationFailureContext = {
  failureMessage: string;
  startupFailureEvidence: StartupFailureEvidence | null;
  latestStartupEvent: StartupEventSummary | null;
};

function withBootstrapAttachmentTerminationTarget(input: {
  result: ReconcileSandboxInstanceResult;
  expectedOwnerLeaseId: string;
  expectedSessionId?: string;
}): ReconcileSandboxInstanceResult {
  return {
    ...input.result,
    bootstrapAttachmentTerminationTarget: {
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
      ...(input.expectedSessionId === undefined
        ? {}
        : { expectedSessionId: input.expectedSessionId }),
    },
  };
}

function withUsageEventState(input: {
  result: ReconcileSandboxInstanceResult;
  sandboxInstance: ActiveSandboxInstance;
}): ReconcileSandboxInstanceResult {
  return {
    ...input.result,
    usageEventState: {
      organizationId: input.sandboxInstance.organizationId,
      runtimeProvider: input.sandboxInstance.runtimeProvider,
      providerSandboxId: input.sandboxInstance.providerSandboxId,
      computeGeneration: input.sandboxInstance.computeGeneration,
      vcpuCount: input.sandboxInstance.sandboxVcpuCount,
      memoryMb: input.sandboxInstance.sandboxMemoryMb,
      diskMb: input.sandboxInstance.sandboxDiskMb,
    },
  };
}

function isTerminalCleanupFenceMatched(input: {
  expectedOwnerLeaseId: string;
  snapshot: SandboxRuntimeStateSnapshot;
}): boolean {
  if (
    input.snapshot.ownerLeaseId !== null &&
    input.snapshot.ownerLeaseId !== input.expectedOwnerLeaseId
  ) {
    return false;
  }

  return (
    input.snapshot.attachment === null ||
    input.snapshot.attachment.ownerLeaseId === input.expectedOwnerLeaseId
  );
}

function resolveTerminalBootstrapAttachmentTerminationTarget(input: {
  expectedOwnerLeaseId: string;
  snapshot: SandboxRuntimeStateSnapshot;
}): ReconcileBootstrapAttachmentTerminationTarget {
  return {
    expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    ...(input.snapshot.attachment === null
      ? {}
      : { expectedSessionId: input.snapshot.attachment.sessionId }),
  };
}

/**
 * Disconnect reconciliation is fenced the same way the old disconnected-stop
 * path was fenced:
 * - if the bootstrap reattached, do nothing
 * - if ownership changed, do nothing
 * - only reconcile when the sandbox is still unattached for the same owner
 */
export function shouldExecuteSandboxDisconnectReconciliation(input: {
  expectedOwnerLeaseId: string;
  snapshot: SandboxRuntimeStateSnapshot;
}): boolean {
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

/**
 * Disconnect reconciliation only handles sandboxes that already crossed the
 * provider boundary. `pending` is therefore an invariant violation here, while
 * `stopped` / `failed` are terminal no-ops.
 */
async function resolveActiveSandboxInstance(input: {
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  sandboxInstanceId: string;
}): Promise<ActiveSandboxInstance | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      organizationId: true,
      computeGeneration: true,
      runtimeProvider: true,
      sandboxConnectionId: true,
      sandboxVcpuCount: true,
      sandboxMemoryMb: true,
      sandboxDiskMb: true,
      providerSandboxId: true,
      status: true,
    },
    where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
  });

  if (sandboxInstance === undefined) {
    throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
  }

  switch (sandboxInstance.status) {
    case SandboxInstanceStatuses.FAILED:
    case SandboxInstanceStatuses.STOPPED:
      return null;
    case SandboxInstanceStatuses.PENDING:
      throw new Error(
        `Disconnect reconciliation does not support pending sandbox instance '${input.sandboxInstanceId}'.`,
      );
    default:
      if (!isSandboxDisconnectReconciliationCandidate(sandboxInstance.status)) {
        throw new Error("Unsupported sandbox instance status.");
      }

      if (sandboxInstance.providerSandboxId === null) {
        throw new Error(
          `Expected ${sandboxInstance.status} sandbox instance '${input.sandboxInstanceId}' to have a providerSandboxId.`,
        );
      }

      return {
        id: sandboxInstance.id,
        organizationId: sandboxInstance.organizationId,
        computeGeneration: sandboxInstance.computeGeneration,
        runtimeProvider: sandboxInstance.runtimeProvider,
        sandboxConnectionId: sandboxInstance.sandboxConnectionId,
        sandboxVcpuCount: sandboxInstance.sandboxVcpuCount,
        sandboxMemoryMb: sandboxInstance.sandboxMemoryMb,
        sandboxDiskMb: sandboxInstance.sandboxDiskMb,
        providerSandboxId: sandboxInstance.providerSandboxId,
        status: sandboxInstance.status,
      };
  }
}

/**
 * Provider absence is a first-class outcome for reconciliation and is modeled
 * separately from provider-disposition states.
 */
async function inspectProviderStateOrMissing(ctx: {
  sandboxAdapter: SandboxAdapter;
  providerSandboxId: string;
}): Promise<ProviderInspectionSummary> {
  try {
    const inspection = await ctx.sandboxAdapter.inspect({
      id: ctx.providerSandboxId,
    });

    return {
      disposition: inspection.disposition,
      ...extractProviderStatus(inspection.raw),
    };
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    return {
      disposition: "missing",
    };
  }
}

function extractProviderStatus(rawProviderPayload: unknown): { providerStatus?: string } {
  if (typeof rawProviderPayload !== "object" || rawProviderPayload === null) {
    return {};
  }

  if ("status" in rawProviderPayload) {
    const providerStatus = rawProviderPayload.status;
    return typeof providerStatus === "string" ? { providerStatus } : {};
  }

  if ("State" in rawProviderPayload) {
    const state = rawProviderPayload.State;
    if (typeof state === "object" && state !== null && "Status" in state) {
      const providerStatus = state.Status;
      return typeof providerStatus === "string" ? { providerStatus } : {};
    }
  }

  return {};
}

async function isDisconnectReconciliationStillPermitted(ctx: {
  runtimeStateReader: SandboxRuntimeStateReader;
  clock: Clock;
  sandboxInstanceId: string;
  expectedOwnerLeaseId: string;
}): Promise<boolean> {
  const snapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: ctx.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });

  return shouldExecuteSandboxDisconnectReconciliation({
    expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
    snapshot,
  });
}

/**
 * A runtime can disappear between the initial inspect and the explicit stop.
 * In that race, we treat the sandbox as failed rather than silently converting
 * it into a normal stopped state.
 */
async function stopProviderSandboxOrMarkMissing(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  runtimeStateReader: SandboxRuntimeStateReader;
  clock: Clock;
  expectedOwnerLeaseId: string;
  sandboxInstance: ActiveSandboxInstance;
}): Promise<ReconcileSandboxInstanceResult> {
  try {
    await stopSandbox(
      {
        sandboxAdapter: ctx.sandboxAdapter,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
      },
      {
        runtimeProvider: ctx.sandboxInstance.runtimeProvider,
        providerSandboxId: ctx.sandboxInstance.providerSandboxId,
        sandboxInstanceId: ctx.sandboxInstance.id,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    const markFailedOutcome = await markSandboxInstanceFailed({
      db: ctx.db,
      tables: ctx.tables,
      sandboxInstanceId: ctx.sandboxInstance.id,
      currentStatus: ctx.sandboxInstance.status,
      failureCode: "provider_runtime_missing",
      failureMessage:
        "Sandbox runtime was not found at the provider during disconnect reconciliation.",
      stillPermitted: async () =>
        isDisconnectReconciliationStillPermitted({
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          sandboxInstanceId: ctx.sandboxInstance.id,
          expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
        }),
    });
    if (markFailedOutcome === "fence_mismatch") {
      return {
        executed: false,
        outcome: "runtime_state_fence_before_mark",
      };
    }

    if (markFailedOutcome === "already_failed") {
      return {
        executed: false,
        outcome: "already_failed",
      };
    }

    return withUsageEventState({
      result: {
        executed: true,
        outcome: "failed",
        bootstrapAttachmentTerminationTarget: {
          expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
        },
      },
      sandboxInstance: ctx.sandboxInstance,
    });
  }

  const markStoppedOutcome = await markSandboxInstanceStopped({
    db: ctx.db,
    tables: ctx.tables,
    sandboxInstanceId: ctx.sandboxInstance.id,
    currentStatus: ctx.sandboxInstance.status,
    stillPermitted: async () =>
      isDisconnectReconciliationStillPermitted({
        runtimeStateReader: ctx.runtimeStateReader,
        clock: ctx.clock,
        sandboxInstanceId: ctx.sandboxInstance.id,
        expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
      }),
  });
  if (markStoppedOutcome === "fence_mismatch") {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_mark",
    };
  }

  if (markStoppedOutcome === "already_stopped") {
    return {
      executed: false,
      outcome: "already_stopped",
      bootstrapAttachmentTerminationTarget: {
        expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
      },
    };
  }

  return withUsageEventState({
    result: {
      executed: true,
      outcome: "stopped",
      bootstrapAttachmentTerminationTarget: {
        expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
      },
    },
    sandboxInstance: ctx.sandboxInstance,
  });
}

async function stopActiveProviderSandboxDuringDisconnect(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
  db: DataPlaneDatabase;
  tables: DataPlaneTables;
  runtimeStateReader: SandboxRuntimeStateReader;
  clock: Clock;
  expectedOwnerLeaseId: string;
  sandboxInstance: ActiveSandboxInstance;
  logger?: MistleLogger | undefined;
}): Promise<ReconcileSandboxInstanceResult> {
  if (
    !(await isDisconnectReconciliationStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: ctx.sandboxInstance.id,
      expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
    }))
  ) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_stop",
    };
  }

  if (
    !(await isDisconnectReconciliationStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: ctx.sandboxInstance.id,
      expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
    }))
  ) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_mark",
    };
  }

  await applySandboxLifecycleEvent(
    {
      db: ctx.db,
      logger: ctx.logger,
      tables: ctx.tables,
    },
    {
      sandboxInstanceId: ctx.sandboxInstance.id,
      event: SandboxLifecycleEvents.STOP_REQUESTED,
    },
  );

  return stopProviderSandboxOrMarkMissing({
    config: ctx.config,
    controlPlaneInternalClient: ctx.controlPlaneInternalClient,
    sandboxAdapter: ctx.sandboxAdapter,
    sandboxRuntimeControl: ctx.sandboxRuntimeControl,
    db: ctx.db,
    tables: ctx.tables,
    runtimeStateReader: ctx.runtimeStateReader,
    clock: ctx.clock,
    expectedOwnerLeaseId: ctx.expectedOwnerLeaseId,
    sandboxInstance: {
      ...ctx.sandboxInstance,
      status: SandboxInstanceStatuses.STOPPING,
    },
  });
}

/**
 * Reconciles durable sandbox state after disconnect grace elapses.
 *
 * The workflow sequence is:
 * 1. fence on current gateway/runtime attachment state
 * 2. load the durable sandbox row
 * 3. inspect provider-backed runtime truth
 * 4. apply the status/disposition policy matrix
 */
export async function reconcileSandboxInstance(
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
    reason: SandboxReconcileReason;
    expectedOwnerLeaseId: string;
  },
): Promise<ReconcileSandboxInstanceResult> {
  const initialSnapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: input.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });

  const sandboxInstance = await resolveActiveSandboxInstance({
    db: ctx.db,
    tables: ctx.tables,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    if (
      !isTerminalCleanupFenceMatched({
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        snapshot: initialSnapshot,
      })
    ) {
      return {
        executed: false,
        outcome: "runtime_state_fence_before_load",
      };
    }

    return {
      executed: false,
      outcome: "already_terminal",
      bootstrapAttachmentTerminationTarget: resolveTerminalBootstrapAttachmentTerminationTarget({
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        snapshot: initialSnapshot,
      }),
    };
  }

  if (
    !shouldExecuteSandboxDisconnectReconciliation({
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
      snapshot: initialSnapshot,
    })
  ) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_load",
    };
  }

  if (
    !(await isDisconnectReconciliationStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: input.sandboxInstanceId,
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    }))
  ) {
    return {
      executed: false,
      outcome: "runtime_state_fence_before_inspect",
    };
  }

  const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(
    createResolveSandboxRuntimeInput(sandboxInstance),
  );

  const providerInspection = await inspectProviderStateOrMissing({
    sandboxAdapter: resolvedRuntime.sandboxAdapter,
    providerSandboxId: sandboxInstance.providerSandboxId,
  });
  const action = determineDisconnectReconciliationAction({
    sandboxStatus: sandboxInstance.status,
    providerState: providerInspection.disposition,
  });

  switch (action.kind) {
    case "fail": {
      const failureContext = await resolveReconciliationFailureContext({
        db: ctx.db,
        failureCode: action.failureCode,
        failureMessage: action.failureMessage,
        sandboxInstanceId: sandboxInstance.id,
      });
      const markOutcome = await markSandboxInstanceFailed({
        db: ctx.db,
        tables: ctx.tables,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
        failureCode: action.failureCode,
        failureMessage: failureContext.failureMessage,
        stillPermitted: async () =>
          isDisconnectReconciliationStillPermitted({
            runtimeStateReader: ctx.runtimeStateReader,
            clock: ctx.clock,
            sandboxInstanceId: input.sandboxInstanceId,
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          }),
      });
      if (markOutcome === "fence_mismatch") {
        return {
          executed: false,
          outcome: "runtime_state_fence_before_mark",
        };
      }

      if (markOutcome === "already_failed") {
        return {
          executed: false,
          outcome: "already_failed",
          bootstrapAttachmentTerminationTarget: {
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          },
        };
      }

      return withUsageEventState({
        result: withBootstrapAttachmentTerminationTarget({
          result: {
            executed: true,
            outcome: "failed",
            diagnostics: {
              failureCode: action.failureCode,
              providerState: providerInspection.disposition,
              ...(providerInspection.providerStatus === undefined
                ? {}
                : { providerStatus: providerInspection.providerStatus }),
              sandboxStatus: sandboxInstance.status,
              runtimeProvider: sandboxInstance.runtimeProvider,
              providerSandboxId: sandboxInstance.providerSandboxId,
              expectedOwnerLeaseId: input.expectedOwnerLeaseId,
              initialRuntimeState: {
                ownerLeaseId: initialSnapshot.ownerLeaseId,
                attachmentOwnerLeaseId: initialSnapshot.attachment?.ownerLeaseId ?? null,
                attachmentSessionId: initialSnapshot.attachment?.sessionId ?? null,
                attachmentNodeId: initialSnapshot.attachment?.nodeId ?? null,
                presenceActiveCount: initialSnapshot.presence.activeCount,
                keepaliveActive: initialSnapshot.keepalive.active,
                runtimeReady: initialSnapshot.runtime.ready,
              },
              startupFailureEvidence: failureContext.startupFailureEvidence,
              latestStartupEvent: failureContext.latestStartupEvent,
            },
          },
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        }),
        sandboxInstance,
      });
    }
    case "fail_if_startup_failure_evidence_else_stop": {
      const failureContext = await resolveReconciliationFailureContext({
        db: ctx.db,
        failureCode: action.failureCode,
        failureMessage: action.failureMessage,
        sandboxInstanceId: sandboxInstance.id,
      });
      if (failureContext.startupFailureEvidence === null) {
        return stopActiveProviderSandboxDuringDisconnect({
          config: ctx.config,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxAdapter: resolvedRuntime.sandboxAdapter,
          sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
          db: ctx.db,
          tables: ctx.tables,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          sandboxInstance,
          logger: ctx.logger,
        });
      }

      const markOutcome = await markSandboxInstanceFailed({
        db: ctx.db,
        tables: ctx.tables,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
        failureCode: action.failureCode,
        failureMessage: failureContext.failureMessage,
        stillPermitted: async () =>
          isDisconnectReconciliationStillPermitted({
            runtimeStateReader: ctx.runtimeStateReader,
            clock: ctx.clock,
            sandboxInstanceId: input.sandboxInstanceId,
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          }),
      });
      if (markOutcome === "fence_mismatch") {
        return {
          executed: false,
          outcome: "runtime_state_fence_before_mark",
        };
      }

      if (markOutcome === "already_failed") {
        return {
          executed: false,
          outcome: "already_failed",
          bootstrapAttachmentTerminationTarget: {
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          },
        };
      }

      return withUsageEventState({
        result: withBootstrapAttachmentTerminationTarget({
          result: {
            executed: true,
            outcome: "failed",
            diagnostics: {
              failureCode: action.failureCode,
              providerState: providerInspection.disposition,
              ...(providerInspection.providerStatus === undefined
                ? {}
                : { providerStatus: providerInspection.providerStatus }),
              sandboxStatus: sandboxInstance.status,
              runtimeProvider: sandboxInstance.runtimeProvider,
              providerSandboxId: sandboxInstance.providerSandboxId,
              expectedOwnerLeaseId: input.expectedOwnerLeaseId,
              initialRuntimeState: {
                ownerLeaseId: initialSnapshot.ownerLeaseId,
                attachmentOwnerLeaseId: initialSnapshot.attachment?.ownerLeaseId ?? null,
                attachmentSessionId: initialSnapshot.attachment?.sessionId ?? null,
                attachmentNodeId: initialSnapshot.attachment?.nodeId ?? null,
                presenceActiveCount: initialSnapshot.presence.activeCount,
                keepaliveActive: initialSnapshot.keepalive.active,
                runtimeReady: initialSnapshot.runtime.ready,
              },
              startupFailureEvidence: failureContext.startupFailureEvidence,
              latestStartupEvent: failureContext.latestStartupEvent,
            },
          },
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        }),
        sandboxInstance,
      });
    }
    case "mark_stopped": {
      const markOutcome = await markSandboxInstanceStopped({
        db: ctx.db,
        tables: ctx.tables,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
        clearProviderSandboxId: false,
        stillPermitted: async () =>
          isDisconnectReconciliationStillPermitted({
            runtimeStateReader: ctx.runtimeStateReader,
            clock: ctx.clock,
            sandboxInstanceId: input.sandboxInstanceId,
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
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
          bootstrapAttachmentTerminationTarget: {
            expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          },
        };
      }

      return withUsageEventState({
        result: withBootstrapAttachmentTerminationTarget({
          result: {
            executed: true,
            outcome: "stopped",
          },
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        }),
        sandboxInstance,
      });
    }
    case "stop_then_mark_stopped":
      return stopActiveProviderSandboxDuringDisconnect({
        config: ctx.config,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        sandboxAdapter: resolvedRuntime.sandboxAdapter,
        sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
        db: ctx.db,
        tables: ctx.tables,
        runtimeStateReader: ctx.runtimeStateReader,
        clock: ctx.clock,
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        sandboxInstance,
        logger: ctx.logger,
      });
    case "retry_provider_stop_in_progress":
      throw new Error(action.reason);
  }
}

async function resolveReconciliationFailureContext(input: {
  db: DataPlaneDatabase;
  failureCode: string;
  failureMessage: string;
  sandboxInstanceId: string;
}): Promise<ReconciliationFailureContext> {
  if (!shouldEnrichStartupDisconnectFailure({ failureCode: input.failureCode })) {
    return {
      failureMessage: input.failureMessage,
      startupFailureEvidence: null,
      latestStartupEvent: null,
    };
  }

  const [startupFailureEvidence, latestStartupEvent] = await Promise.all([
    resolveStartupFailureEvidence({
      db: input.db,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
    resolveLatestStartupEventSummary({
      db: input.db,
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  ]);

  return {
    failureMessage: formatStartupDisconnectFailureMessage({
      baseFailureMessage: input.failureMessage,
      evidence: startupFailureEvidence,
    }),
    startupFailureEvidence,
    latestStartupEvent,
  };
}
