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
}): Promise<"fence_mismatch" | "stopped" | "failed"> {
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
      return markFailedOutcome === "fence_mismatch" ? "fence_mismatch" : "failed";
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
    return markStoppedOutcome === "fence_mismatch" ? "fence_mismatch" : "stopped";
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
  return markStoppedOutcome === "fence_mismatch" ? "fence_mismatch" : "stopped";
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
): Promise<boolean> {
  if (
    !(await isDisconnectReconciliationStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: input.sandboxInstanceId,
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    }))
  ) {
    return false;
  }

  const sandboxInstance = await resolveActiveSandboxInstance({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    return false;
  }

  if (
    !(await isDisconnectReconciliationStillPermitted({
      runtimeStateReader: ctx.runtimeStateReader,
      clock: ctx.clock,
      sandboxInstanceId: input.sandboxInstanceId,
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
    }))
  ) {
    return false;
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
    case "fail":
      return (
        (await markSandboxInstanceFailed({
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
        })) !== "fence_mismatch"
      );
    case "mark_stopped":
      return (
        (await markSandboxInstanceStopped({
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
        })) !== "fence_mismatch"
      );
    case "stop_then_mark_stopped":
      if (
        !(await isDisconnectReconciliationStillPermitted({
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          sandboxInstanceId: input.sandboxInstanceId,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        }))
      ) {
        return false;
      }

      return (
        (await stopProviderSandboxOrMarkMissing({
          config: ctx.config,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxAdapter: ctx.sandboxAdapter,
          db: ctx.db,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
          expectedOwnerLeaseId: input.expectedOwnerLeaseId,
          sandboxInstance,
        })) !== "fence_mismatch"
      );
  }
}
