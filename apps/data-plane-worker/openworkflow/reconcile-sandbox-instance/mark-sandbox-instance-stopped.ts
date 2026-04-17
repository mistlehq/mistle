import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  currentStatus: "starting" | "running";
  clearProviderSandboxId?: boolean;
}): Promise<void> {
  const updatedRows = await ctx.db.transaction(async (tx) => {
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

    if (stoppedRows[0]?.status === SandboxInstanceStatuses.STOPPED) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        sandboxInstanceId: ctx.sandboxInstanceId,
      });
    }

    return stoppedRows;
  });

  if (updatedRows[0]?.status === SandboxInstanceStatuses.STOPPED) {
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

  throw new Error(
    `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
  );
}
