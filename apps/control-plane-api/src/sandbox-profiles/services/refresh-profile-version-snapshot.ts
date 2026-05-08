import {
  ControlPlaneConstraintIds,
  getControlPlaneDatabaseSchema,
  isControlPlaneUniqueViolation,
  type SandboxProfileVersionDefaultPersistenceMode,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";
import { typeid } from "typeid-js";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { enqueueSnapshotMaterializationJob } from "./enqueue-snapshot-materialization-job.js";
import {
  loadActiveRefreshSchedulesByVersion,
  type ProfileVersionRefreshScheduleSummary,
} from "./profile-version-refresh-schedule-summary.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type RefreshProfileVersionSnapshotInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type SnapshotRefreshIntent =
  | {
      trigger: typeof SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH;
      requireMissingSnapshot: false;
    }
  | {
      trigger: typeof SandboxProfileVersionSnapshotJobTriggers.PUBLISH;
      requireMissingSnapshot: true;
    };

type RefreshProfileVersionSnapshotOutput = {
  version: {
    sandboxProfileId: string;
    version: number;
    state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
    defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
    isActive: boolean;
    usable: boolean;
    refreshSchedule: ProfileVersionRefreshScheduleSummary | null;
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
  return await queueProfileVersionSnapshot(
    {
      db,
      dataPlaneClient,
      defaultBaseImage,
    },
    input,
    {
      trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
      requireMissingSnapshot: false,
    },
  );
}

export async function retryPublishProfileVersionSnapshot(
  {
    db,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: RefreshProfileVersionSnapshotInput,
): Promise<RefreshProfileVersionSnapshotOutput> {
  return await queueProfileVersionSnapshot(
    {
      db,
      dataPlaneClient,
      defaultBaseImage,
    },
    input,
    {
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      requireMissingSnapshot: true,
    },
  );
}

async function queueProfileVersionSnapshot(
  {
    db,
    dataPlaneClient,
    defaultBaseImage,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "dataPlaneClient"> & {
    defaultBaseImage: string;
  },
  input: RefreshProfileVersionSnapshotInput,
  intent: SnapshotRefreshIntent,
): Promise<RefreshProfileVersionSnapshotOutput> {
  const sandboxInstanceId = typeid("sbi").toString();

  try {
    const refreshResult = await db.transaction(async (tx) => {
      const tables = getControlPlaneDatabaseSchema(tx);

      const [sandboxProfileVersion] = await tx
        .select({
          profileId: tables.sandboxProfiles.id,
          activeVersion: tables.sandboxProfiles.activeVersion,
          sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
          version: tables.sandboxProfileVersions.version,
          state: tables.sandboxProfileVersions.state,
          defaultPersistenceMode: tables.sandboxProfileVersions.defaultPersistenceMode,
          snapshotImageProvider: tables.sandboxProfileVersions.snapshotImageProvider,
          snapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
        })
        .from(tables.sandboxProfiles)
        .leftJoin(
          tables.sandboxProfileVersions,
          and(
            eq(tables.sandboxProfileVersions.sandboxProfileId, tables.sandboxProfiles.id),
            eq(tables.sandboxProfileVersions.version, input.profileVersion),
          ),
        )
        .where(
          and(
            eq(tables.sandboxProfiles.id, input.profileId),
            eq(tables.sandboxProfiles.organizationId, input.organizationId),
          ),
        );

      if (sandboxProfileVersion === undefined) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
          "Sandbox profile was not found.",
        );
      }

      if (sandboxProfileVersion.state === null) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
          "Sandbox profile version was not found.",
        );
      }

      const resolvedSandboxProfileId = sandboxProfileVersion.sandboxProfileId;
      const resolvedSandboxProfileVersion = sandboxProfileVersion.version;
      const resolvedDefaultPersistenceMode = sandboxProfileVersion.defaultPersistenceMode;
      if (resolvedSandboxProfileId === null || resolvedSandboxProfileVersion === null) {
        throw new Error("Expected joined sandbox profile version metadata to be present.");
      }
      if (resolvedDefaultPersistenceMode === null) {
        throw new Error("Expected joined sandbox profile persistence mode to be present.");
      }

      if (sandboxProfileVersion.state !== SandboxProfileVersionStates.PUBLISHED) {
        throw new SandboxProfilesConflictError(
          SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
          `Sandbox profile version '${String(input.profileVersion)}' is not refreshable because it is not a published version.`,
        );
      }

      const versionHasUsableSnapshot =
        sandboxProfileVersion.snapshotImageProvider !== null &&
        sandboxProfileVersion.snapshotImageId !== null;

      if (intent.requireMissingSnapshot) {
        if (versionHasUsableSnapshot) {
          throw new SandboxProfilesConflictError(
            SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
            `Sandbox profile version '${String(input.profileVersion)}' already has a usable snapshot.`,
          );
        }
      } else if (!versionHasUsableSnapshot) {
        throw new SandboxProfilesConflictError(
          SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
          `Sandbox profile version '${String(input.profileVersion)}' does not have a usable snapshot. Retry snapshot creation from the publish recovery action.`,
        );
      }

      const refreshSchedulesByVersion = await loadActiveRefreshSchedulesByVersion({
        db: tx,
        profileId: input.profileId,
      });
      const [snapshotJob] = await tx
        .insert(tables.sandboxProfileVersionSnapshotJobs)
        .values({
          sandboxProfileId: input.profileId,
          sandboxProfileVersion: input.profileVersion,
          trigger: intent.trigger,
          state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        })
        .returning({
          id: tables.sandboxProfileVersionSnapshotJobs.id,
          trigger: tables.sandboxProfileVersionSnapshotJobs.trigger,
          state: tables.sandboxProfileVersionSnapshotJobs.state,
          errorCode: tables.sandboxProfileVersionSnapshotJobs.errorCode,
          errorMessage: tables.sandboxProfileVersionSnapshotJobs.errorMessage,
          createdAt: tables.sandboxProfileVersionSnapshotJobs.createdAt,
          startedAt: tables.sandboxProfileVersionSnapshotJobs.startedAt,
          finishedAt: tables.sandboxProfileVersionSnapshotJobs.finishedAt,
        });

      if (snapshotJob === undefined) {
        throw new Error(
          `Failed to create snapshot job for sandbox profile '${input.profileId}' version '${String(input.profileVersion)}'.`,
        );
      }

      return {
        version: {
          sandboxProfileId: resolvedSandboxProfileId,
          version: resolvedSandboxProfileVersion,
          state: sandboxProfileVersion.state,
          defaultPersistenceMode: resolvedDefaultPersistenceMode,
          isActive: sandboxProfileVersion.activeVersion === input.profileVersion,
          usable: versionHasUsableSnapshot,
          refreshSchedule: refreshSchedulesByVersion.get(resolvedSandboxProfileVersion) ?? null,
          latestSnapshotJob: snapshotJob,
        },
        activeVersion: sandboxProfileVersion.activeVersion,
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
