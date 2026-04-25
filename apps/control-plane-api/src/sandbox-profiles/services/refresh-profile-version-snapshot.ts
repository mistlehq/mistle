import {
  ControlPlaneConstraintIds,
  isControlPlaneUniqueViolation,
  sandboxProfileVersionSnapshotJobs,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { typeid } from "typeid-js";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { enqueueSnapshotMaterializationJob } from "./enqueue-snapshot-materialization-job.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type RefreshProfileVersionSnapshotInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type RefreshProfileVersionSnapshotOutput = {
  version: {
    sandboxProfileId: string;
    version: number;
    state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
    isActive: boolean;
    usable: boolean;
    latestSnapshotJob: {
      id: string;
      trigger: (typeof SandboxProfileVersionSnapshotJobTriggers)[keyof typeof SandboxProfileVersionSnapshotJobTriggers];
      state: (typeof SandboxProfileVersionSnapshotJobStates)[keyof typeof SandboxProfileVersionSnapshotJobStates];
      errorCode: string | null;
      errorMessage: string | null;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
    };
  };
  activeVersion: number | null;
  snapshotJob: {
    id: string;
    trigger: (typeof SandboxProfileVersionSnapshotJobTriggers)[keyof typeof SandboxProfileVersionSnapshotJobTriggers];
    state: (typeof SandboxProfileVersionSnapshotJobStates)[keyof typeof SandboxProfileVersionSnapshotJobStates];
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
};

export async function refreshProfileVersionSnapshot(
  {
    db,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: RefreshProfileVersionSnapshotInput,
): Promise<RefreshProfileVersionSnapshotOutput> {
  const sandboxInstanceId = typeid("sbi").toString();

  try {
    const refreshResult = await db.transaction(async (tx) => {
      const sandboxProfile = await tx.query.sandboxProfiles.findFirst({
        columns: {
          id: true,
          activeVersion: true,
        },
        where: (table, { and, eq }) =>
          and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
      });

      if (sandboxProfile === undefined) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
          "Sandbox profile was not found.",
        );
      }

      const sandboxProfileVersion = await tx.query.sandboxProfileVersions.findFirst({
        columns: {
          sandboxProfileId: true,
          version: true,
          state: true,
          snapshotImageProvider: true,
          snapshotImageId: true,
        },
        where: (table, { and, eq }) =>
          and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
      });

      if (sandboxProfileVersion === undefined) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
          "Sandbox profile version was not found.",
        );
      }

      if (
        sandboxProfileVersion.state !== SandboxProfileVersionStates.PUBLISHED ||
        sandboxProfileVersion.snapshotImageProvider === null ||
        sandboxProfileVersion.snapshotImageId === null
      ) {
        throw new SandboxProfilesConflictError(
          SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
          `Sandbox profile version '${String(input.profileVersion)}' is not refreshable because it is not a usable published version.`,
        );
      }

      const [snapshotJob] = await tx
        .insert(sandboxProfileVersionSnapshotJobs)
        .values({
          sandboxProfileId: input.profileId,
          sandboxProfileVersion: input.profileVersion,
          trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
          state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        })
        .returning({
          id: sandboxProfileVersionSnapshotJobs.id,
          trigger: sandboxProfileVersionSnapshotJobs.trigger,
          state: sandboxProfileVersionSnapshotJobs.state,
          errorCode: sandboxProfileVersionSnapshotJobs.errorCode,
          errorMessage: sandboxProfileVersionSnapshotJobs.errorMessage,
          createdAt: sandboxProfileVersionSnapshotJobs.createdAt,
          startedAt: sandboxProfileVersionSnapshotJobs.startedAt,
          finishedAt: sandboxProfileVersionSnapshotJobs.finishedAt,
        });

      if (snapshotJob === undefined) {
        throw new Error(
          `Failed to create refresh snapshot job for sandbox profile '${input.profileId}' version '${String(input.profileVersion)}'.`,
        );
      }

      return {
        version: {
          sandboxProfileId: sandboxProfileVersion.sandboxProfileId,
          version: sandboxProfileVersion.version,
          state: sandboxProfileVersion.state,
          isActive: sandboxProfile.activeVersion === input.profileVersion,
          usable: true,
          latestSnapshotJob: snapshotJob,
        },
        activeVersion: sandboxProfile.activeVersion,
        snapshotJob,
      };
    });

    await enqueueSnapshotMaterializationJob(
      {
        db,
        dataPlaneClient,
        defaultBaseImage,
      },
      {
        snapshotJobId: refreshResult.snapshotJob.id,
        sandboxInstanceId,
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
      },
    );

    return refreshResult;
  } catch (error) {
    if (
      isControlPlaneUniqueViolation(
        error,
        ControlPlaneConstraintIds.SNAPSHOT_JOB_ACTIVE_PER_VERSION,
      )
    ) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_SNAPSHOT_IN_PROGRESS,
        `Sandbox profile version '${String(input.profileVersion)}' already has a snapshot job in progress.`,
      );
    }

    throw error;
  }
}
