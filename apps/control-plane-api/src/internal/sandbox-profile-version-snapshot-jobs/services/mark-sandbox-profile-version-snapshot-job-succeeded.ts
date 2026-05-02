import {
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionStates,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
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
    const tables = getControlPlaneDatabaseSchema(tx);

    const [lockedRow] = await tx
      .select({
        state: tables.sandboxProfileVersionSnapshotJobs.state,
        workflowRunId: tables.sandboxProfileVersionSnapshotJobs.workflowRunId,
        candidateImageProvider: tables.sandboxProfileVersionSnapshotJobs.candidateImageProvider,
        candidateImageId: tables.sandboxProfileVersionSnapshotJobs.candidateImageId,
        sandboxProfileId: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId,
        sandboxProfileVersion: tables.sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
        versionState: tables.sandboxProfileVersions.state,
        versionSnapshotImageProvider: tables.sandboxProfileVersions.snapshotImageProvider,
        versionSnapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
        activeVersion: tables.sandboxProfiles.activeVersion,
      })
      .from(tables.sandboxProfileVersionSnapshotJobs)
      .innerJoin(
        tables.sandboxProfileVersions,
        and(
          eq(
            tables.sandboxProfileVersions.sandboxProfileId,
            tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId,
          ),
          eq(
            tables.sandboxProfileVersions.version,
            tables.sandboxProfileVersionSnapshotJobs.sandboxProfileVersion,
          ),
        ),
      )
      .innerJoin(
        tables.sandboxProfiles,
        eq(tables.sandboxProfiles.id, tables.sandboxProfileVersionSnapshotJobs.sandboxProfileId),
      )
      .where(eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId))
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
      .update(tables.sandboxProfileVersionSnapshotJobs)
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
          eq(tables.sandboxProfileVersionSnapshotJobs.id, input.snapshotJobId),
          eq(
            tables.sandboxProfileVersionSnapshotJobs.state,
            SandboxProfileVersionSnapshotJobStates.RUNNING,
          ),
          eq(tables.sandboxProfileVersionSnapshotJobs.workflowRunId, input.workflowRunId),
        ),
      )
      .returning({
        id: tables.sandboxProfileVersionSnapshotJobs.id,
      });

    if (updatedRows[0] === undefined) {
      throw createSnapshotJobStateConflictError({
        snapshotJobId: input.snapshotJobId,
        actualState,
        message: "Snapshot job could not be marked succeeded.",
      });
    }

    const promotedVersions = await tx
      .update(tables.sandboxProfileVersions)
      .set({
        snapshotImageProvider: input.image.provider,
        snapshotImageId: input.image.imageId,
      })
      .where(
        and(
          eq(tables.sandboxProfileVersions.sandboxProfileId, sandboxProfileId),
          eq(tables.sandboxProfileVersions.version, sandboxProfileVersion),
          eq(tables.sandboxProfileVersions.state, SandboxProfileVersionStates.PUBLISHED),
        ),
      )
      .returning({
        sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
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
        .update(tables.sandboxProfiles)
        .set({
          activeVersion: sandboxProfileVersion,
        })
        .where(eq(tables.sandboxProfiles.id, sandboxProfileId));
    }
  });

  return {
    status: "ok",
  };
}
