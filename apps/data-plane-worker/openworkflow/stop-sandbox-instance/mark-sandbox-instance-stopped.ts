import {
  type SandboxStopReason,
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  assertSandboxInstanceLifecycleStatus,
  SandboxLifecycleEvents,
  transitionSandboxLifecycle,
} from "@mistle/sandbox-lifecycle";
import { and, eq, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

type MarkSandboxInstanceStoppedOutcome = "already_stopped" | "fence_mismatch" | "stopped";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  stillPermitted?: () => Promise<boolean>;
}): Promise<MarkSandboxInstanceStoppedOutcome> {
  const { sandboxInstances } = ctx.tables;
  const outcome = await ctx.db.transaction(async (tx) => {
    const lockedRows = await tx.execute(
      sql<{ status: string }>`
        select status
        from ${sandboxInstances}
        where id = ${ctx.sandboxInstanceId}
        for update
      `,
    );
    const lockedRow = lockedRows.rows[0];

    if (lockedRow === undefined) {
      throw new Error(`Sandbox instance '${ctx.sandboxInstanceId}' was not found.`);
    }
    const lockedStatus = lockedRow.status;
    if (typeof lockedStatus !== "string") {
      throw new Error(`Sandbox instance '${ctx.sandboxInstanceId}' returned a non-string status.`);
    }

    if (lockedStatus === SandboxInstanceStatuses.STOPPED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        tables: ctx.tables,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
      return "already_stopped";
    }

    assertSandboxInstanceLifecycleStatus(lockedStatus);
    const transition = transitionSandboxLifecycle({
      status: lockedStatus,
      event: SandboxLifecycleEvents.PROVIDER_STOPPED,
    });

    if (transition.kind !== "transition" || transition.to !== SandboxInstanceStatuses.STOPPED) {
      throw new Error("Failed to transition sandbox instance status from stopping to stopped.");
    }

    if (ctx.stillPermitted !== undefined && !(await ctx.stillPermitted())) {
      return "fence_mismatch";
    }

    const stoppedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.STOPPED,
        stoppedAt: sql`now()`,
        stopReason: ctx.stopReason,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, ctx.sandboxInstanceId),
          eq(sandboxInstances.status, transition.from),
        ),
      )
      .returning({
        id: sandboxInstances.id,
      });

    if (stoppedRows[0] === undefined) {
      throw new Error("Failed to transition sandbox instance status from stopping to stopped.");
    }

    await clearSandboxInstanceDeadlines({
      db: tx,
      tables: ctx.tables,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });

    return "stopped";
  });

  return outcome;
}
