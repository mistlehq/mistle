import type { DataPlaneDatabase, SandboxInstanceDeadlineKind } from "@mistle/db/data-plane";
import type { SandboxAdapter } from "@mistle/sandbox";
import type { Clock } from "@mistle/time";
import type { HandleSandboxInstanceDeadlineWorkflowOutput } from "@mistle/workflow-registry/data-plane";

import type { SandboxRuntimeStateReader } from "../../runtime-state/sandbox-runtime-state-reader.js";
import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { reconcileSandboxInstance } from "../reconcile-sandbox-instance/reconcile-sandbox-instance.js";
import { stopSandboxInstance } from "../stop-sandbox-instance/stop-sandbox-instance.js";
import { findSandboxInstanceDeadline } from "./find-sandbox-instance-deadline.js";

export async function handleSandboxInstanceDeadline(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
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
): Promise<HandleSandboxInstanceDeadlineWorkflowOutput> {
  const deadline = await findSandboxInstanceDeadline({
    db: ctx.db,
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
  });

  if (
    deadline === undefined ||
    deadline.clearedAt !== null ||
    deadline.generation !== input.generation ||
    deadline.ownerLeaseId !== input.ownerLeaseId ||
    deadline.dueAt !== input.dueAt
  ) {
    return {
      sandboxInstanceId: input.sandboxInstanceId,
      kind: input.kind,
      executed: false,
    };
  }

  const executed = await executeDeadlineAction(ctx, {
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    ownerLeaseId: deadline.ownerLeaseId,
  });

  return {
    sandboxInstanceId: input.sandboxInstanceId,
    kind: input.kind,
    executed,
  };
}

async function executeDeadlineAction(
  ctx: {
    config: DataPlaneWorkerRuntimeConfig;
    db: DataPlaneDatabase;
    sandboxAdapter: SandboxAdapter;
    runtimeStateReader: SandboxRuntimeStateReader;
    clock: Clock;
  },
  input: {
    sandboxInstanceId: string;
    kind: SandboxInstanceDeadlineKind;
    ownerLeaseId: string;
  },
): Promise<boolean> {
  switch (input.kind) {
    case "idle":
      return stopSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
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
