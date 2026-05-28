import {
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStatus,
} from "@mistle/db/data-plane";
import { type SandboxLifecycleEvent, transitionSandboxLifecycle } from "@mistle/sandbox-lifecycle";
import { and, eq, isNull, sql } from "drizzle-orm";

type LifecycleWritableDatabase = Pick<DataPlaneDatabase, "query" | "update">;

export async function applySandboxLifecycleEvent(
  ctx: {
    db: LifecycleWritableDatabase;
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

  return transition.to;
}
