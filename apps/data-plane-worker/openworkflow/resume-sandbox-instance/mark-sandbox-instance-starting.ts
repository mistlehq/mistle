import {
  SandboxInstanceStatuses,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function markSandboxInstanceStarting(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
}): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.STARTING,
      providerRuntimeId: null,
      stoppedAt: null,
      stopReason: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, ctx.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STOPPED),
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

  if (sandboxInstance?.status === SandboxInstanceStatuses.STARTING) {
    return;
  }

  throw new Error("Failed to transition sandbox instance status from stopped to starting.");
}
