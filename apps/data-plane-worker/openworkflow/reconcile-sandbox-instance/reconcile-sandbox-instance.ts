import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type SandboxInstancePersistenceMode,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import {
  isSandboxResourceNotFoundError,
  type SandboxAdapter,
  type SandboxInspectDisposition,
} from "@mistle/sandbox";
import type { Clock } from "@mistle/time";
import type { SandboxReconcileReason } from "@mistle/workflow-registry/data-plane";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { determineDisconnectReconciliationAction } from "./disconnect-reconciliation-policy.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped } from "./mark-sandbox-instance-stopped.js";

type ActiveSandboxInstance = {
  id: string;
  persistenceMode: SandboxInstancePersistenceMode;
  runtimeProvider: SandboxInstanceProvider;
  providerSandboxId: string;
  status: "starting" | "running";
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

export type ReconcileSandboxInstanceResult = {
  executed: boolean;
  outcome: ReconcileSandboxInstanceOutcome;
};

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
  sandboxInstanceId: string;
}): Promise<ActiveSandboxInstance | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
      persistenceMode: true,
      runtimeProvider: true,
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
    case SandboxInstanceStatuses.STARTING:
    case SandboxInstanceStatuses.RUNNING:
      if (sandboxInstance.providerSandboxId === null) {
        throw new Error(
          `Expected ${sandboxInstance.status} sandbox instance '${input.sandboxInstanceId}' to have a providerSandboxId.`,
        );
      }

      return {
        id: sandboxInstance.id,
        persistenceMode: sandboxInstance.persistenceMode,
        runtimeProvider: sandboxInstance.runtimeProvider,
        providerSandboxId: sandboxInstance.providerSandboxId,
        status: sandboxInstance.status,
      };
    default:
      throw new Error("Unsupported sandbox instance status.");
  }
}

/**
 * Provider absence is a first-class outcome for reconciliation and is modeled
 * separately from provider-disposition states.
 */
async function inspectProviderStateOrMissing(ctx: {
  sandboxAdapter: SandboxAdapter;
  providerSandboxId: string;
}): Promise<SandboxInspectDisposition | "missing"> {
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
  db: DataPlaneDatabase;
  runtimeStateReader: SandboxRuntimeStateReader;
  clock: Clock;
  expectedOwnerLeaseId: string;
  sandboxInstance: ActiveSandboxInstance;
}): Promise<ReconcileSandboxInstanceResult> {
  try {
    await stopSandbox(
      {
        db: ctx.db,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
      },
      {
        sandboxInstanceId: ctx.sandboxInstance.id,
        persistenceMode: ctx.sandboxInstance.persistenceMode,
        runtimeProvider: ctx.sandboxInstance.runtimeProvider,
        providerSandboxId: ctx.sandboxInstance.providerSandboxId,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    if (ctx.sandboxInstance.persistenceMode !== "persistent") {
      const markFailedOutcome = await markSandboxInstanceFailed({
        db: ctx.db,
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

      return {
        executed: true,
        outcome: "failed",
      };
    }

    const markStoppedOutcome = await markSandboxInstanceStopped({
      db: ctx.db,
      sandboxInstanceId: ctx.sandboxInstance.id,
      currentStatus: ctx.sandboxInstance.status,
      clearProviderSandboxId: true,
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
      };
    }

    return {
      executed: true,
      outcome: "stopped",
    };
  }

  const markStoppedOutcome = await markSandboxInstanceStopped({
    db: ctx.db,
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
    };
  }

  return {
    executed: true,
    outcome: "stopped",
  };
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
    controlPlaneInternalClient: ControlPlaneInternalClient;
    sandboxAdapter: SandboxAdapter;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input: {
    sandboxInstanceId: string;
    reason: SandboxReconcileReason;
    expectedOwnerLeaseId: string;
  },
): Promise<ReconcileSandboxInstanceResult> {
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
      outcome: "runtime_state_fence_before_load",
    };
  }

  const sandboxInstance = await resolveActiveSandboxInstance({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    return {
      executed: false,
      outcome: "already_terminal",
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

  const providerState = await inspectProviderStateOrMissing({
    sandboxAdapter: ctx.sandboxAdapter,
    providerSandboxId: sandboxInstance.providerSandboxId,
  });
  const action = determineDisconnectReconciliationAction({
    persistenceMode: sandboxInstance.persistenceMode,
    sandboxStatus: sandboxInstance.status,
    providerState,
  });

  switch (action.kind) {
    case "fail": {
      const markOutcome = await markSandboxInstanceFailed({
        db: ctx.db,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
        failureCode: action.failureCode,
        failureMessage: action.failureMessage,
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
        };
      }

      return {
        executed: true,
        outcome: "failed",
      };
    }
    case "mark_stopped": {
      const markOutcome = await markSandboxInstanceStopped({
        db: ctx.db,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
        clearProviderSandboxId: sandboxInstance.persistenceMode === "persistent",
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
        };
      }

      return {
        executed: true,
        outcome: "stopped",
      };
    }
    case "stop_then_mark_stopped":
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
          outcome: "runtime_state_fence_before_stop",
        };
      }

      return stopProviderSandboxOrMarkMissing({
        config: ctx.config,
        controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        sandboxAdapter: ctx.sandboxAdapter,
        db: ctx.db,
        runtimeStateReader: ctx.runtimeStateReader,
        clock: ctx.clock,
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        sandboxInstance,
      });
  }
}
