import {
  SandboxInstanceStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import { and, eq, isNull, sql } from "drizzle-orm";

export async function markSandboxInstanceRunning(
  ctx: {
    db: DataPlaneDatabase;
    tables: Pick<DataPlaneTables, "sandboxInstances">;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const { sandboxInstances } = ctx.tables;
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.RUNNING,
      startedAt: sql`now()`,
      stopReason: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
        isNull(sandboxInstances.deletedAt),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error("Failed to transition sandbox instance status from starting to running.");
  }
}
