import {
  type SandboxStopReason,
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
}): Promise<void> {
  const updatedRows = await ctx.db.transaction(async (tx) => {
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

    if (stoppedRows[0] !== undefined) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
    }

    return stoppedRows;
  });

  if (updatedRows[0] !== undefined) {
    return;
  }

  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, ctx.sandboxInstanceId),
  });
  if (sandboxInstance?.status === SandboxInstanceStatuses.STOPPED) {
    await clearSandboxInstanceDeadlines({
      db: ctx.db,
      sandboxInstanceId: ctx.sandboxInstanceId,
    });
    return;
  }

  throw new Error("Failed to transition sandbox instance status from running to stopped.");
}
