import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type SandboxInstanceProvider,
} from "@mistle/db/data-plane";
import {
  classifySandboxInspectProviderState,
  isSandboxResourceNotFoundError,
  type SandboxAdapter,
} from "@mistle/sandbox";
import type { Clock } from "@mistle/time";
import type { SandboxReconcileReason } from "@mistle/workflow-registry/data-plane";

import type {
  SandboxRuntimeStateReader,
  SandboxRuntimeStateSnapshot,
} from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import {
  determineDisconnectReconciliationAction,
  type DisconnectProviderState,
} from "./disconnect-reconciliation-policy.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceStopped } from "./mark-sandbox-instance-stopped.js";

type ActiveSandboxInstance = {
  id: string;
  runtimeProvider: SandboxInstanceProvider;
  providerSandboxId: string;
  status: "starting" | "running";
};

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

async function resolveActiveSandboxInstance(input: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<ActiveSandboxInstance | null> {
  const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
    columns: {
      id: true,
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
        runtimeProvider: sandboxInstance.runtimeProvider,
        providerSandboxId: sandboxInstance.providerSandboxId,
        status: sandboxInstance.status,
      };
    default:
      throw new Error("Unsupported sandbox instance status.");
  }
}

async function inspectProviderStateOrMissing(ctx: {
  sandboxAdapter: SandboxAdapter;
  providerSandboxId: string;
}): Promise<DisconnectProviderState | "missing"> {
  try {
    const inspection = await ctx.sandboxAdapter.inspect({
      id: ctx.providerSandboxId,
    });

    return classifySandboxInspectProviderState(inspection);
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    return "missing";
  }
}

async function stopProviderSandboxOrMarkMissing(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  sandboxAdapter: SandboxAdapter;
  db: DataPlaneDatabase;
  sandboxInstance: ActiveSandboxInstance;
}): Promise<"stopped" | "failed"> {
  try {
    await stopSandbox(
      {
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
      },
      {
        runtimeProvider: ctx.sandboxInstance.runtimeProvider,
        providerSandboxId: ctx.sandboxInstance.providerSandboxId,
      },
    );
  } catch (error) {
    if (!isSandboxResourceNotFoundError(error)) {
      throw error;
    }

    await markSandboxInstanceFailed({
      db: ctx.db,
      sandboxInstanceId: ctx.sandboxInstance.id,
      currentStatus: ctx.sandboxInstance.status,
      failureCode: "provider_runtime_missing",
      failureMessage:
        "Sandbox runtime was not found at the provider during disconnect reconciliation.",
    });
    return "failed";
  }

  await markSandboxInstanceStopped({
    db: ctx.db,
    sandboxInstanceId: ctx.sandboxInstance.id,
    currentStatus: ctx.sandboxInstance.status,
  });
  return "stopped";
}

export async function reconcileSandboxInstance(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input: {
    sandboxInstanceId: string;
    reason: SandboxReconcileReason;
    expectedOwnerLeaseId: string;
  },
): Promise<void> {
  const snapshot = await ctx.runtimeStateReader.readSnapshot({
    sandboxInstanceId: input.sandboxInstanceId,
    nowMs: ctx.clock.nowMs(),
  });
  if (
    !shouldExecuteSandboxDisconnectReconciliation({
      expectedOwnerLeaseId: input.expectedOwnerLeaseId,
      snapshot,
    })
  ) {
    return;
  }

  const sandboxInstance = await resolveActiveSandboxInstance({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    return;
  }

  const providerState = await inspectProviderStateOrMissing({
    sandboxAdapter: ctx.sandboxAdapter,
    providerSandboxId: sandboxInstance.providerSandboxId,
  });
  const action = determineDisconnectReconciliationAction({
    sandboxStatus: sandboxInstance.status,
    providerState,
  });

  switch (action.kind) {
    case "fail":
      await markSandboxInstanceFailed({
        db: ctx.db,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
        failureCode: action.failureCode,
        failureMessage: action.failureMessage,
      });
      return;
    case "mark_stopped":
      await markSandboxInstanceStopped({
        db: ctx.db,
        sandboxInstanceId: sandboxInstance.id,
        currentStatus: sandboxInstance.status,
      });
      return;
    case "stop_then_mark_stopped":
      await stopProviderSandboxOrMarkMissing({
        config: ctx.config,
        sandboxAdapter: ctx.sandboxAdapter,
        db: ctx.db,
        sandboxInstance,
      });
      return;
  }
}
