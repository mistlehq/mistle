import {
  ControlPlaneConstraintIds,
  getControlPlaneDatabaseSchema,
  isControlPlaneUniqueViolation,
  type SandboxProfileVersionAgentRuntimeId,
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
import {
  enqueueSnapshotMaterializationJob,
  type SnapshotMaterializationImageInput,
} from "./enqueue-snapshot-materialization-job.js";
import {
  loadActiveRefreshSchedulesByVersion,
  type ProfileVersionRefreshScheduleSummary,
} from "./profile-version-refresh-schedule-summary.js";
import {
  createWorkflowSandboxRuntime,
  mapProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type RefreshProfileVersionSnapshotInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  refreshKind?: "setup" | "maintenance";
};

type SnapshotRefreshIntent =
  | {
      trigger: typeof SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH;
      requireMissingSnapshot: false;
      refreshKind: "setup" | "maintenance";
    }
  | {
      trigger: typeof SandboxProfileVersionSnapshotJobTriggers.PUBLISH;
      requireMissingSnapshot: true;
      refreshKind: "setup";
    };

type RefreshProfileVersionSnapshotOutput = {
  version: {
    sandboxProfileId: string;
    version: number;
    state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
    defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
    agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
    mistleMcpEnabled: boolean;
    mistleMcpApiKeyId: string | null;
    sandboxProvider: string | null;
    sandboxConnectionId: string | null;
    maintenanceScript: string | null;
    sandboxResources: SandboxProfileVersionResources | null;
    isActive: boolean;
    usable: boolean;
    refreshSchedule: ProfileVersionRefreshScheduleSummary | null;
    latestSnapshotJob: {
      id: string;
      sandboxInstanceId: string | null;
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
    sandboxInstanceId: string | null;
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
      refreshKind: input.refreshKind ?? "setup",
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
      refreshKind: "setup",
    },
  );
}

function hasNonBlankScript(script: string | null): boolean {
  return script !== null && script.trim().length > 0;
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
          agentRuntimeId: tables.sandboxProfileVersions.agentRuntimeId,
          mistleMcpEnabled: tables.sandboxProfileVersions.mistleMcpEnabled,
          mistleMcpApiKeyId: tables.sandboxProfileVersions.mistleMcpApiKeyId,
          snapshotImageProvider: tables.sandboxProfileVersions.snapshotImageProvider,
          snapshotImageId: tables.sandboxProfileVersions.snapshotImageId,
          maintenanceScript: tables.sandboxProfileVersions.maintenanceScript,
          sandboxProvider: tables.sandboxProfileVersions.sandboxProvider,
          sandboxConnectionId: tables.sandboxProfileVersions.sandboxConnectionId,
          sandboxVcpuCount: tables.sandboxProfileVersions.sandboxVcpuCount,
          sandboxMemoryMb: tables.sandboxProfileVersions.sandboxMemoryMb,
          sandboxStorageMb: tables.sandboxProfileVersions.sandboxStorageMb,
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
      const resolvedAgentRuntimeId = sandboxProfileVersion.agentRuntimeId;
      const resolvedMistleMcpEnabled = sandboxProfileVersion.mistleMcpEnabled;
      const resolvedMistleMcpApiKeyId = sandboxProfileVersion.mistleMcpApiKeyId;
      const resolvedSandboxProvider = sandboxProfileVersion.sandboxProvider;
      const resolvedSandboxConnectionId = sandboxProfileVersion.sandboxConnectionId;
      const resolvedSandboxVcpuCount = sandboxProfileVersion.sandboxVcpuCount;
      const resolvedSandboxMemoryMb = sandboxProfileVersion.sandboxMemoryMb;
      const resolvedSandboxStorageMb = sandboxProfileVersion.sandboxStorageMb;
      if (resolvedSandboxProfileId === null || resolvedSandboxProfileVersion === null) {
        throw new Error("Expected joined sandbox profile version metadata to be present.");
      }
      if (resolvedDefaultPersistenceMode === null) {
        throw new Error("Expected joined sandbox profile persistence mode to be present.");
      }
      if (resolvedAgentRuntimeId === null) {
        throw new Error("Expected joined sandbox profile agent runtime id to be present.");
      }
      if (resolvedMistleMcpEnabled === null) {
        throw new Error("Expected joined sandbox profile Mistle MCP enabled state to be present.");
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

      if (
        intent.refreshKind === "maintenance" &&
        !hasNonBlankScript(sandboxProfileVersion.maintenanceScript)
      ) {
        throw new SandboxProfilesConflictError(
          SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_USABLE,
          `Sandbox profile version '${String(input.profileVersion)}' does not have a maintenance script.`,
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
          sandboxInstanceId,
          trigger: intent.trigger,
          state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        })
        .returning({
          id: tables.sandboxProfileVersionSnapshotJobs.id,
          sandboxInstanceId: tables.sandboxProfileVersionSnapshotJobs.sandboxInstanceId,
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
          agentRuntimeId: resolvedAgentRuntimeId,
          mistleMcpEnabled: resolvedMistleMcpEnabled,
          mistleMcpApiKeyId: resolvedMistleMcpApiKeyId,
          maintenanceScript: sandboxProfileVersion.maintenanceScript,
          ...mapProfileVersionRuntimeConfig({
            sandboxProvider: resolvedSandboxProvider,
            sandboxConnectionId: resolvedSandboxConnectionId,
            sandboxVcpuCount: resolvedSandboxVcpuCount,
            sandboxMemoryMb: resolvedSandboxMemoryMb,
            sandboxStorageMb: resolvedSandboxStorageMb,
          }),
          isActive: sandboxProfileVersion.activeVersion === input.profileVersion,
          usable: versionHasUsableSnapshot,
          refreshSchedule: refreshSchedulesByVersion.get(resolvedSandboxProfileVersion) ?? null,
          latestSnapshotJob: snapshotJob,
        },
        activeVersion: sandboxProfileVersion.activeVersion,
        snapshotJob,
        snapshotImage: {
          provider: sandboxProfileVersion.snapshotImageProvider,
          imageId: sandboxProfileVersion.snapshotImageId,
        },
      };
    });

    const sandboxRuntime = createWorkflowSandboxRuntime(refreshResult.version);
    let materializationImage: SnapshotMaterializationImageInput;
    if (intent.refreshKind === "setup") {
      materializationImage = {
        imageId: defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: "base",
        provider: sandboxRuntime.provider,
      };
    } else {
      const snapshotImageId = refreshResult.snapshotImage.imageId;
      if (snapshotImageId === null) {
        throw new Error("Expected maintenance refresh to have a usable snapshot image.");
      }

      materializationImage = {
        imageId: snapshotImageId,
        createdAt: new Date().toISOString(),
        kind: "snapshot",
        provider: sandboxRuntime.provider,
      };
    }

    await enqueueSnapshotMaterializationJob(
      {
        db,
        dataPlaneClient,
      },
      {
        snapshotJobId: refreshResult.snapshotJob.id,
        sandboxInstanceId,
        organizationId: input.organizationId,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
        snapshotPreparationScriptKind: intent.refreshKind,
        image: materializationImage,
        sandboxRuntime,
      },
    );

    return {
      version: refreshResult.version,
      activeVersion: refreshResult.activeVersion,
      snapshotJob: refreshResult.snapshotJob,
    };
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
