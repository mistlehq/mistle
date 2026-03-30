import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  currentStatus: "starting" | "running";
}): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.STOPPED,
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
    return;
  }

  throw new Error(
    `Failed to transition sandbox instance status from ${ctx.currentStatus} to stopped.`,
  );
}
