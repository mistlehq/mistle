import {
  type SandboxStopReason,
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

type MarkSandboxInstanceStoppedOutcome = "already_stopped" | "fence_mismatch" | "stopped";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
  stillPermitted?: () => Promise<boolean>;
}): Promise<MarkSandboxInstanceStoppedOutcome> {
  const outcome = await ctx.db.transaction(async (tx) => {
    const lockedRows = await tx.execute(
      sql<{ status: string }>`
        select status
        from "data_plane"."sandbox_instances"
        where id = ${ctx.sandboxInstanceId}
        for update
      `,
    );
    const lockedRow = lockedRows.rows[0];

    if (lockedRow === undefined) {
      throw new Error(`Sandbox instance '${ctx.sandboxInstanceId}' was not found.`);
    }

    if (lockedRow.status === SandboxInstanceStatuses.STOPPED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
      return "already_stopped";
    }

    if (lockedRow.status !== SandboxInstanceStatuses.RUNNING) {
      throw new Error("Failed to transition sandbox instance status from running to stopped.");
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
          eq(sandboxInstances.status, SandboxInstanceStatuses.RUNNING),
        ),
      )
      .returning({
        id: sandboxInstances.id,
      });

    if (stoppedRows[0] === undefined) {
      throw new Error("Failed to transition sandbox instance status from running to stopped.");
    }

    await clearSandboxInstanceDeadlines({
      db: tx,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });

    return "stopped";
  });

  return outcome;
}
