import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, sql } from "drizzle-orm";

export async function markSandboxInstanceFailed(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstances)
    .set({
      status: SandboxInstanceStatuses.FAILED,
      stopReason: SandboxStopReasons.FAILED,
      failedAt: sql`now()`,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(sandboxInstances.id, input.sandboxInstanceId),
        eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
      ),
    )
    .returning({
      id: sandboxInstances.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error("Failed to transition sandbox instance status from starting to failed.");
  }
}
