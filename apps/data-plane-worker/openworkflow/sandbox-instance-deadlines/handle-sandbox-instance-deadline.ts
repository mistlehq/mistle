import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneDatabase, SandboxInstanceDeadlineKind } from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import type { Clock } from "@mistle/time";
import type { HandleSandboxInstanceDeadlineWorkflowOutput } from "@mistle/workflow-registry/data-plane";

import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import {
  reconcileSandboxInstance,
  type ReconcileSandboxInstanceResult,
} from "../reconcile-sandbox-instance/reconcile-sandbox-instance.js";
import {
  stopSandboxInstance,
  type StopSandboxInstanceResult,
} from "../stop-sandbox-instance/stop-sandbox-instance.js";
import { findSandboxInstanceDeadline } from "./find-sandbox-instance-deadline.js";

export type HandleSandboxInstanceDeadlineOutcome =
  | "executed"
  | "deadline_missing"
  | "deadline_cleared"
  | "deadline_generation_mismatch"
  | "deadline_owner_lease_mismatch"
  | "deadline_due_at_mismatch"
  | `action_${StopSandboxInstanceResult["outcome"]}`
  | `action_${ReconcileSandboxInstanceResult["outcome"]}`;

export type HandleSandboxInstanceDeadlineResult = HandleSandboxInstanceDeadlineWorkflowOutput & {
  outcome: HandleSandboxInstanceDeadlineOutcome;
};

export async function handleSandboxInstanceDeadline(
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
    kind: SandboxInstanceDeadlineKind;
    ownerLeaseId: string;
    dueAt: string;
    generation: number;
  },
): Promise<HandleSandboxInstanceDeadlineResult> {
  const deadline = await findSandboxInstanceDeadline({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  });

  if (deadline === undefined) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      executed: false,
      outcome: "deadline_missing",
    };
  }

  if (deadline.clearedAt !== null) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      executed: false,
      outcome: "deadline_cleared",
    };
  }

  if (deadline.generation !== input.generation) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      executed: false,
      outcome: "deadline_generation_mismatch",
    };
  }

  if (deadline.ownerLeaseId !== input.ownerLeaseId) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      executed: false,
      outcome: "deadline_owner_lease_mismatch",
    };
  }

  if (deadline.dueAt !== input.dueAt) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      executed: false,
      outcome: "deadline_due_at_mismatch",
    };
  }

  const actionResult = await executeDeadlineAction(ctx, {
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    ownerLeaseId: deadline.ownerLeaseId,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    executed: actionResult.executed,
    outcome: actionResult.executed ? "executed" : `action_${actionResult.outcome}`,
  };
}

async function executeDeadlineAction(
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
    kind: SandboxInstanceDeadlineKind;
    ownerLeaseId: string;
  },
): Promise<StopSandboxInstanceResult | ReconcileSandboxInstanceResult> {
  switch (input.kind) {
    case "idle":
      return stopSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxAdapter: ctx.sandboxAdapter,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          stopReason: "idle",
          expectedOwnerLeaseId: input.ownerLeaseId,
        },
      );
    case "disconnect":
      return reconcileSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
          sandboxAdapter: ctx.sandboxAdapter,
          runtimeStateReader: ctx.runtimeStateReader,
          clock: ctx.clock,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
          reason: "disconnect_grace_elapsed",
          expectedOwnerLeaseId: input.ownerLeaseId,
        },
      );
  }
}
