import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import type { MistleLogger } from "@mistle/logging";
import { type SandboxLifecycleEvent, transitionSandboxLifecycle } from "@mistle/sandbox-lifecycle";
import { and, eq, isNull, sql } from "drizzle-orm";

type LifecycleWritableDatabase = Pick<DataPlaneDatabase, "query" | "update">;

export async function applySandboxLifecycleEvent(
  ctx: {
    db: LifecycleWritableDatabase;
    logger?: MistleLogger | undefined;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
  },
  input: {
    sandboxInstanceId: string;
    event: SandboxLifecycleEvent;
  },
): Promise<SandboxInstanceStatus> {
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { and, eq, isNull }) =>
      and(eq(table.id, input.sandboxInstanceId), isNull(table.deletedAt)),
  });
  if (sandboxInstance === undefined) {
    throw new Error(
      `Sandbox instance '${input.sandboxInstanceId}' was not found for lifecycle event '${input.event}'.`,
    );
  }

  const transition = transitionSandboxLifecycle({
    status: sandboxInstance.status,
    event: input.event,
  });

  if (transition.kind === "invalid") {
    throw new Error(transition.reason);
  }

  if (transition.kind === "unchanged") {
    return transition.status;
  }

  const { sandboxInstances } = ctx.tables;
  const updatedRows = await ctx.db
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
    const currentSandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
      },
      where: (table, { and, eq, isNull }) =>
        and(eq(table.id, input.sandboxInstanceId), isNull(table.deletedAt)),
    });
    if (currentSandboxInstance === undefined) {
      throw new Error(
        `Sandbox instance '${input.sandboxInstanceId}' was not found after lifecycle event '${input.event}' missed its compare-and-swap update.`,
      );
    }

    const currentTransition = transitionSandboxLifecycle({
      status: currentSandboxInstance.status,
      event: input.event,
    });
    if (currentTransition.kind === "unchanged") {
      return currentTransition.status;
    }

    throw new Error(
      `Failed to apply sandbox lifecycle event '${input.event}' from '${transition.from}' to '${transition.to}'.`,
    );
  }

  ctx.logger?.info(
    {
      eventName: resolveSandboxLifecycleLogEventName({
        from: transition.from,
        to: transition.to,
      }),
      sandboxInstanceId: input.sandboxInstanceId,
      lifecycleEvent: input.event,
      previousStatus: transition.from,
      status: transition.to,
    },
    "Applied sandbox lifecycle transition.",
  );

  return transition.to;
}

function resolveSandboxLifecycleLogEventName(input: {
  from: SandboxInstanceStatus;
  to: SandboxInstanceStatus;
}): string {
  if (input.from === "reconnecting" && input.to === "running") {
    return "sandbox.reconnected";
  }

  switch (input.to) {
    case "starting":
      return "sandbox.starting";
    case "started":
      return "sandbox.started";
    case "initializing":
      return "sandbox.initializing";
    case "running":
      return "sandbox.running";
    case "reconnecting":
      return "sandbox.reconnecting";
    case "stopping":
      return "sandbox.stopping";
    case "stopped":
      return "sandbox.stopped";
    case "failed":
      return "sandbox.failed";
    case "pending":
      return "sandbox.pending";
  }
}
