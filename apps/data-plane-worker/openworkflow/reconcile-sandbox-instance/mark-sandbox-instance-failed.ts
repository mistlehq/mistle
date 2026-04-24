import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

type MarkSandboxInstanceFailedOutcome = "already_failed" | "fence_mismatch" | "failed";

export async function markSandboxInstanceFailed(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  currentStatus: "starting" | "running";
  failureCode: string;
  failureMessage: string;
  stillPermitted?: () => Promise<boolean>;
}): Promise<MarkSandboxInstanceFailedOutcome> {
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

    if (lockedRow.status === SandboxInstanceStatuses.FAILED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
      return "already_failed";
    }

    if (lockedRow.status !== ctx.currentStatus) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to failed.`,
      );
    }

    if (ctx.stillPermitted !== undefined && !(await ctx.stillPermitted())) {
      return "fence_mismatch";
    }

    const failedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.FAILED,
        stopReason: SandboxStopReasons.FAILED,
        stoppedAt: null,
        failedAt: sql`now()`,
        failureCode: ctx.failureCode,
        failureMessage: ctx.failureMessage,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxInstances.id, ctx.sandboxInstanceId),
          eq(sandboxInstances.status, ctx.currentStatus),
        ),
      )
      .returning({
        status: sandboxInstances.status,
      });

    if (failedRows[0]?.status !== SandboxInstanceStatuses.FAILED) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to failed.`,
      );
    }

    await clearSandboxInstanceDeadlines({
      db: tx,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });

    return "failed";
  });

  return outcome;
}
