import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function markSandboxInstanceFailed(ctx: {
  db: DataPlaneDatabase;
  sandboxInstanceId: string;
  currentStatus: "starting" | "running";
  failureCode: string;
  failureMessage: string;
}): Promise<void> {
  const updatedRows = await ctx.db
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

  if (updatedRows[0]?.status === SandboxInstanceStatuses.FAILED) {
    return;
  }

  // A concurrent reconciler may have already moved the row to `failed`, which
  // we treat as idempotent success rather than an invariant violation.
  const sandboxInstance = await ctx.db.query.sandboxInstances.findFirst({
    columns: {
      status: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, ctx.sandboxInstanceId),
  });
  if (sandboxInstance?.status === SandboxInstanceStatuses.FAILED) {
    return;
  }

  throw new Error(
    `Failed to transition sandbox instance status from ${ctx.currentStatus} to failed.`,
  );
}
