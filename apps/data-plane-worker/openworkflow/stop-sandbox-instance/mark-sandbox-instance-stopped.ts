import {
  type SandboxStopReason,
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function markSandboxInstanceStopped(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  stopReason: SandboxStopReason;
}): Promise<void> {
  const updatedRows = await ctx.db
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
    return;
  }

  throw new Error("Failed to transition sandbox instance status from running to stopped.");
}
