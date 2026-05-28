import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import {
  SandboxInstanceStatuses,
  SandboxLifecycleEvents,
  transitionSandboxLifecycle,
} from "@mistle/sandbox-lifecycle";
import { and, eq, isNull, sql } from "drizzle-orm";

type ApplySandboxRuntimeLifecycleEventContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstances">;
};

export type SandboxRuntimeLifecycleEventKind = "bootstrap_detached" | "runtime_readiness_reported";

export type ApplySandboxRuntimeLifecycleEventInput =
  | {
      sandboxInstanceId: string;
      kind: "bootstrap_detached";
      ownerLeaseId: string;
    }
  | {
      sandboxInstanceId: string;
      kind: "runtime_readiness_reported";
      ownerLeaseId: string;
      runtimeReady: boolean;
    };

export type ApplySandboxRuntimeLifecycleEventResponse = {
  status: "ok";
  sandboxInstanceId: string;
  lifecycleStatus: SandboxInstanceStatus;
};

export async function applySandboxRuntimeLifecycleEvent(
  ctx: ApplySandboxRuntimeLifecycleEventContext,
  input: ApplySandboxRuntimeLifecycleEventInput,
): Promise<ApplySandboxRuntimeLifecycleEventResponse> {
  const lifecycleStatus = await ctx.db.transaction(async (tx) => {
    const sandboxInstance = await tx.query.sandboxInstances.findFirst({
      columns: {
        status: true,
      },
      where: (table, { and, eq, isNull }) =>
        and(eq(table.id, input.sandboxInstanceId), isNull(table.deletedAt)),
    });
    if (sandboxInstance === undefined) {
      throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
    }

    const event = resolveLifecycleEvent({
      status: sandboxInstance.status,
      kind: input.kind,
      ...(input.kind === "runtime_readiness_reported" ? { runtimeReady: input.runtimeReady } : {}),
    });
    if (event === undefined) {
      return sandboxInstance.status;
    }

    const transition = transitionSandboxLifecycle({
      status: sandboxInstance.status,
      event,
    });
    if (transition.kind === "invalid") {
      throw new Error(transition.reason);
    }
    if (transition.kind === "unchanged") {
      return transition.status;
    }

    const { sandboxInstances } = ctx.tables;
    const updatedRows = await tx
      .update(sandboxInstances)
      .set({
        status: transition.to,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, input.sandboxInstanceId),
          eq(sandboxInstances.status, transition.from),
          isNull(sandboxInstances.deletedAt),
        ),
      )
      .returning({
        status: sandboxInstances.status,
      });
    if (updatedRows[0]?.status !== transition.to) {
      throw new Error(
        `Failed to apply sandbox lifecycle event '${event}' from '${transition.from}' to '${transition.to}'.`,
      );
    }

    return transition.to;
  });

  return {
    status: "ok",
    sandboxInstanceId: input.sandboxInstanceId,
    lifecycleStatus,
  };
}

function resolveLifecycleEvent(input: {
  status: SandboxInstanceStatus;
  kind: SandboxRuntimeLifecycleEventKind;
  runtimeReady?: boolean;
}): (typeof SandboxLifecycleEvents)[keyof typeof SandboxLifecycleEvents] | undefined {
  if (input.kind === "bootstrap_detached") {
    if (input.status === SandboxInstanceStatuses.RECONNECTING) {
      return undefined;
    }
    if (input.status !== SandboxInstanceStatuses.RUNNING) {
      return undefined;
    }
    return SandboxLifecycleEvents.BOOTSTRAP_DETACHED;
  }

  if (input.status === SandboxInstanceStatuses.RECONNECTING) {
    return input.runtimeReady
      ? SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_READY
      : SandboxLifecycleEvents.BOOTSTRAP_REATTACHED_NOT_READY;
  }

  if (
    input.runtimeReady &&
    (input.status === SandboxInstanceStatuses.INITIALIZING ||
      input.status === SandboxInstanceStatuses.RUNNING)
  ) {
    return SandboxLifecycleEvents.RUNTIME_READY;
  }

  return undefined;
}
