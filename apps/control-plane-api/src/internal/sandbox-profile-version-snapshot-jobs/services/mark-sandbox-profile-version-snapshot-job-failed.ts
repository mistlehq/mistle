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
    const lockedRows = await tx.execute(sql<{
      state: string;
      workflow_run_id: string | null;
      error_code: string | null;
      error_message: string | null;
    }>`
      select state, workflow_run_id, error_code, error_message
      from "control_plane"."sandbox_profile_version_snapshot_jobs"
      where id = ${input.snapshotJobId}
      for update
    `);

    const lockedRow = lockedRows.rows[0];
    if (lockedRow === undefined) {
      throw createSnapshotJobNotFoundError(input.snapshotJobId);
    }

    const actualState =
      typeof lockedRow.state === "string"
        ? lockedRow.state
        : (() => {
            throw new Error("Expected snapshot job state to be a string.");
          })();
    const workflowRunId =
      typeof lockedRow.workflow_run_id === "string" ? lockedRow.workflow_run_id : null;
    const errorCode = typeof lockedRow.error_code === "string" ? lockedRow.error_code : null;
    const errorMessage =
      typeof lockedRow.error_message === "string" ? lockedRow.error_message : null;

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
