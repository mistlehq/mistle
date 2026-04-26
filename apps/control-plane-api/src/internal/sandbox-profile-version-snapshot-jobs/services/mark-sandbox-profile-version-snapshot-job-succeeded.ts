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
    const [lockedRow] = await tx
      .select({
        state: sandboxProfileVersionSnapshotJobs.state,
        workflowRunId: sandboxProfileVersionSnapshotJobs.workflowRunId,
        candidateImageProvider: sandboxProfileVersionSnapshotJobs.candidateImageProvider,
        candidateImageId: sandboxProfileVersionSnapshotJobs.candidateImageId,
      })
      .from(sandboxProfileVersionSnapshotJobs)
      .where(eq(sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId))
      .for("update");

    if (lockedRow === undefined) {
      throw createSnapshotJobNotFoundError(input.snapshotJobId);
    }

    const actualState = lockedRow.state;
    const workflowRunId = lockedRow.workflowRunId;
    const candidateImageProvider = lockedRow.candidateImageProvider;
    const candidateImageId = lockedRow.candidateImageId;

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
