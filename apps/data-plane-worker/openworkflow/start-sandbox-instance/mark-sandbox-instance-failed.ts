import {
  SandboxInstanceStatuses,
  SandboxStopReasons,
  sandboxInstances,
  type DataPlaneDatabase,
} from "@mistle/db/data-plane";
import { and, eq, or, sql } from "drizzle-orm";

import { clearSandboxInstanceDeadlines } from "../sandbox-instance-deadlines/clear-sandbox-instance-deadlines.js";

export async function markSandboxInstanceFailed(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    failureCode: string;
    failureMessage: string;
    allowStoppedCurrentStatus?: boolean;
  },
): Promise<void> {
  const updatedRows = await ctx.db.transaction(async (tx) => {
    const failedRows = await tx
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
          or(
            eq(sandboxInstances.status, SandboxInstanceStatuses.PENDING),
            eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
            ...(input.allowStoppedCurrentStatus === true
              ? [eq(sandboxInstances.status, SandboxInstanceStatuses.STOPPED)]
              : []),
          ),
        ),
      )
      .returning({
        id: sandboxInstances.id,
      });

    if (failedRows[0] !== undefined) {
      await clearSandboxInstanceDeadlines({
        db: tx,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    }

    return failedRows;
  });

  if (updatedRows[0] === undefined) {
    throw new Error("Failed to transition sandbox instance status to failed.");
  }
}
