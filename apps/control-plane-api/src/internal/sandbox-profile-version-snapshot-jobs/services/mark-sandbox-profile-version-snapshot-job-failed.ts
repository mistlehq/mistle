import {
  sandboxProfileVersionSnapshotJobs,
  SandboxProfileVersionSnapshotJobStates,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  createSnapshotJobNotFoundError,
  createSnapshotJobOwnershipMismatchError,
  createSnapshotJobStateConflictError,
} from "./errors.js";

export async function markSandboxProfileVersionSnapshotJobFailed(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    snapshotJobId: string;
    workflowRunId: string;
    errorCode: string;
    errorMessage: string;
  },
): Promise<{ status: "ok" }> {
  await ctx.db.transaction(async (tx) => {
    const [lockedRow] = await tx
      .select({
        state: sandboxProfileVersionSnapshotJobs.state,
        workflowRunId: sandboxProfileVersionSnapshotJobs.workflowRunId,
        errorCode: sandboxProfileVersionSnapshotJobs.errorCode,
        errorMessage: sandboxProfileVersionSnapshotJobs.errorMessage,
      })
      .from(sandboxProfileVersionSnapshotJobs)
      .where(eq(sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId))
      .for("update");

    if (lockedRow === undefined) {
      throw createSnapshotJobNotFoundError(input.snapshotJobId);
    }

    const actualState = lockedRow.state;
    const workflowRunId = lockedRow.workflowRunId;
    const errorCode = lockedRow.errorCode;
    const errorMessage = lockedRow.errorMessage;

    if (workflowRunId !== input.workflowRunId) {
      throw createSnapshotJobOwnershipMismatchError({
        snapshotJobId: input.snapshotJobId,
        workflowRunId,
      });
    }

    if (
      actualState === SandboxProfileVersionSnapshotJobStates.FAILED &&
      errorCode === input.errorCode &&
      errorMessage === input.errorMessage
    ) {
      return;
    }

    if (actualState !== SandboxProfileVersionSnapshotJobStates.RUNNING) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job is not running and cannot be marked failed.",
      });
    }

    const updatedRows = await tx
      .update(sandboxProfileVersionSnapshotJobs)
      .set({
        state: SandboxProfileVersionSnapshotJobStates.FAILED,
        candidateImageProvider: null,
        candidateImageId: null,
        finishedAt: sql`now()`,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId),
          eq(
            sandboxProfileVersionSnapshotJobs.state,
            SandboxProfileVersionSnapshotJobStates.RUNNING,
          ),
          eq(sandboxProfileVersionSnapshotJobs.workflowRunId, input.workflowRunId),
        ),
      )
      .returning({
        id: sandboxProfileVersionSnapshotJobs.id,
      });

    if (updatedRows[0] === undefined) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job could not be marked failed.",
      });
    }
  });

  return {
    status: "ok",
  };
}
