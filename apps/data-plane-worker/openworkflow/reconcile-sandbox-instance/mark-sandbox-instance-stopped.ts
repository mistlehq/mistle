import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

type MarkSandboxInstanceStoppedOutcome = "already_stopped" | "fence_mismatch" | "stopped";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceDeadlines" | "sandboxInstances">;
  sandboxInstanceId: string;
  currentStatus: "starting" | "running";
  clearProviderSandboxId?: boolean;
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

    if (lockedRow.status === SandboxInstanceStatuses.STOPPED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        tables: ctx.tables,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
      return "already_stopped";
    }

    if (lockedRow.status !== ctx.currentStatus) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
      );
    }

    if (ctx.stillPermitted !== undefined && !(await ctx.stillPermitted())) {
      return "fence_mismatch";
    }

    const stoppedRows = await tx
      .update(sandboxInstances)
      .set({
        status: SandboxInstanceStatuses.STOPPED,
        ...(ctx.clearProviderSandboxId === true ? { providerSandboxId: null } : {}),
        stoppedAt: sql`now()`,
        failedAt: null,
        stopReason: SandboxStopReasons.DISCONNECTED,
        failureCode: null,
        failureMessage: null,
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

    if (stoppedRows[0]?.status !== SandboxInstanceStatuses.STOPPED) {
      throw new Error(
        `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
      );
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
