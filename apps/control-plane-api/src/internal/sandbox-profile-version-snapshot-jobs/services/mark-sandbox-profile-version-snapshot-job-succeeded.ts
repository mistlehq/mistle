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

export async function markSandboxProfileVersionSnapshotJobSucceeded(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    snapshotJobId: string;
    workflowRunId: string;
    image: {
      provider: string;
      imageId: string;
    };
  },
): Promise<{ status: "ok" }> {
  await ctx.db.transaction(async (tx) => {
    const lockedRows = await tx.execute(sql<{
      state: string;
      workflow_run_id: string | null;
      candidate_image_provider: string | null;
      candidate_image_id: string | null;
    }>`
      select state, workflow_run_id, candidate_image_provider, candidate_image_id
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
    const candidateImageProvider =
      typeof lockedRow.candidate_image_provider === "string"
        ? lockedRow.candidate_image_provider
        : null;
    const candidateImageId =
      typeof lockedRow.candidate_image_id === "string" ? lockedRow.candidate_image_id : null;

    if (workflowRunId !== input.workflowRunId) {
      throw createSnapshotJobOwnershipMismatchError({
        snapshotJobId: input.snapshotJobId,
        workflowRunId,
      });
    }

    if (
      actualState === SandboxProfileVersionSnapshotJobStates.SUCCEEDED &&
      candidateImageProvider === input.image.provider &&
      candidateImageId === input.image.imageId
    ) {
      return;
    }

    if (actualState !== SandboxProfileVersionSnapshotJobStates.RUNNING) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job is not running and cannot be marked succeeded.",
      });
    }

    const updatedRows = await tx
      .update(sandboxProfileVersionSnapshotJobs)
      .set({
        state: SandboxProfileVersionSnapshotJobStates.SUCCEEDED,
        candidateImageProvider: input.image.provider,
        candidateImageId: input.image.imageId,
        finishedAt: sql`now()`,
        errorCode: null,
        errorMessage: null,
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
        message: "Snapshot job could not be marked succeeded.",
      });
    }
  });

  return {
    status: "ok",
  };
}
