import {
  sandboxProfiles,
  sandboxProfileVersionSnapshotJobs,
  sandboxProfileVersions,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionStates,
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
        sandboxProfileId: sandboxProfileVersionSnapshotJobs.sandboxProfileId,
        sandboxProfileVersion: sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
        versionState: sandboxProfileVersions.state,
        versionSnapshotImageProvider: sandboxProfileVersions.snapshotImageProvider,
        versionSnapshotImageId: sandboxProfileVersions.snapshotImageId,
        activeVersion: sandboxProfiles.activeVersion,
      })
      .from(sandboxProfileVersionSnapshotJobs)
      .innerJoin(
        sandboxProfileVersions,
        and(
          eq(
            sandboxProfileVersions.sandboxProfileId,
            sandboxProfileVersionSnapshotJobs.sandboxProfileId,
          ),
          eq(
            sandboxProfileVersions.version,
            sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
          ),
        ),
      )
      .innerJoin(
        sandboxProfiles,
        eq(sandboxProfiles.id, sandboxProfileVersionSnapshotJobs.sandboxProfileId),
      )
      .where(eq(sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId))
      .for("update");

    if (lockedRow === undefined) {
      throw createSnapshotJobNotFoundError(input.snapshotJobId);
    }

    const actualState = lockedRow.state;
    const workflowRunId = lockedRow.workflowRunId;
    const candidateImageProvider = lockedRow.candidateImageProvider;
    const candidateImageId = lockedRow.candidateImageId;
    const sandboxProfileId = lockedRow.sandboxProfileId;
    const sandboxProfileVersion = lockedRow.sandboxProfileVersion;
    const versionState = lockedRow.versionState;
    const versionSnapshotImageProvider = lockedRow.versionSnapshotImageProvider;
    const versionSnapshotImageId = lockedRow.versionSnapshotImageId;
    const activeVersion = lockedRow.activeVersion;

    if (workflowRunId !== input.workflowRunId) {
      throw createSnapshotJobOwnershipMismatchError({
        snapshotJobId: input.snapshotJobId,
        workflowRunId,
      });
    }

    if (
      actualState === SandboxProfileVersionSnapshotJobStates.SUCCEEDED &&
      candidateImageProvider === input.image.provider &&
      candidateImageId === input.image.imageId &&
      versionSnapshotImageProvider === input.image.provider &&
      versionSnapshotImageId === input.image.imageId
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

    if (versionState !== SandboxProfileVersionStates.PUBLISHED) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job belongs to a sandbox profile version that is not published.",
      });
    }

    const isInitialMaterialization =
      versionSnapshotImageProvider === null && versionSnapshotImageId === null;

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

    const promotedVersions = await tx
      .update(sandboxProfileVersions)
      .set({
        snapshotImageProvider: input.image.provider,
        snapshotImageId: input.image.imageId,
      })
      .where(
        and(
          eq(sandboxProfileVersions.sandboxProfileId, sandboxProfileId),
          eq(sandboxProfileVersions.version, sandboxProfileVersion),
          eq(sandboxProfileVersions.state, SandboxProfileVersionStates.PUBLISHED),
        ),
      )
      .returning({
        sandboxProfileId: sandboxProfileVersions.sandboxProfileId,
      });

    if (promotedVersions[0] === undefined) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job succeeded but the published version could not be promoted.",
      });
    }

    if (
      isInitialMaterialization &&
      (activeVersion === null || activeVersion < sandboxProfileVersion)
    ) {
      await tx
        .update(sandboxProfiles)
        .set({
          activeVersion: sandboxProfileVersion,
        })
        .where(eq(sandboxProfiles.id, sandboxProfileId));
    }
  });

  return {
    status: "ok",
  };
}
