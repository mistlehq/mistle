import {
  getControlPlaneDatabaseSchema,
  type ControlPlaneTransaction,
  ScheduleKinds,
  ScheduleTargetTypes,
  type SandboxProfileVersionAgentRuntimeId,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { findNextScheduleOccurrence } from "@mistle/time";
import { and, eq, sql } from "drizzle-orm";
import { typeid } from "typeid-js";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { enqueueSnapshotMaterializationJob } from "./enqueue-snapshot-materialization-job.js";
import { getProfileVersionPublishability } from "./get-profile-version-publishability.js";
import {
  loadActiveRefreshSchedulesByVersion,
  type ProfileVersionRefreshScheduleSummary,
} from "./profile-version-refresh-schedule-summary.js";
import {
  createWorkflowSandboxRuntime,
  mapProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
} from "./profile-version-runtime-config.js";
import {
  mapProfileVersionSkillsConfig,
  type SandboxProfileVersionSkillsConfig,
} from "./profile-version-skills-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PublishProfileVersionInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

type PublishProfileVersionOutput = {
  version: {
    sandboxProfileId: string;
    version: number;
    state: (typeof SandboxProfileVersionStates)[keyof typeof SandboxProfileVersionStates];
    publishedAt: string | null;
    agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
    gitCommitSigningIntegrationConnectionId: string | null;
    mistleMcpEnabled: boolean;
    mistleMcpApiKeyId: string | null;
    sandboxProvider: string | null;
    sandboxConnectionId: string | null;
    maintenanceScript: string | null;
    sandboxResources: SandboxProfileVersionResources | null;
    skillsConfig: SandboxProfileVersionSkillsConfig | null;
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

async function copyRefreshScheduleToPublishedVersion(
  tx: ControlPlaneTransaction,
  input: {
    organizationId: string;
    profileId: string;
    fromVersion: number;
    toVersion: number;
    now: Date;
  },
): Promise<ProfileVersionRefreshScheduleSummary | null> {
  const tables = getControlPlaneDatabaseSchema(tx);
  const [sourceTarget] = await tx
    .select({
      scheduleId: tables.sandboxProfileSnapshotRefreshScheduleTargets.scheduleId,
    })
    .from(tables.sandboxProfileSnapshotRefreshScheduleTargets)
    .where(
      and(
        eq(tables.sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileId, input.profileId),
        eq(
          tables.sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileVersion,
          input.fromVersion,
        ),
      ),
    )
    .limit(1);

  if (sourceTarget === undefined) {
    return null;
  }

  const sourceSchedule = await tx.query.schedules.findFirst({
    columns: {
      name: true,
      cronExpression: true,
      timezone: true,
      enabled: true,
    },
    where: (table, { and: whereAnd, eq: whereEq, isNull }) =>
      whereAnd(
        whereEq(table.id, sourceTarget.scheduleId),
        whereEq(table.kind, ScheduleKinds.RECURRING),
        whereEq(table.enabled, true),
        isNull(table.deletedAt),
      ),
  });

  if (sourceSchedule === undefined) {
    return null;
  }
  if (sourceSchedule.cronExpression === null) {
    throw new Error(`Recurring schedule '${sourceTarget.scheduleId}' is missing cron_expression.`);
  }
  if (sourceSchedule.timezone === null) {
    throw new Error(`Recurring schedule '${sourceTarget.scheduleId}' is missing timezone.`);
  }

  const nextOccurrence = findNextScheduleOccurrence({
    after: input.now,
    cronExpression: sourceSchedule.cronExpression,
    timezone: sourceSchedule.timezone,
  });
  if (nextOccurrence === null) {
    throw new Error("Copied snapshot refresh schedule has no next occurrence.");
  }

  const [existingTarget] = await tx
    .select({
      scheduleId: tables.sandboxProfileSnapshotRefreshScheduleTargets.scheduleId,
    })
    .from(tables.sandboxProfileSnapshotRefreshScheduleTargets)
    .where(
      and(
        eq(tables.sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileId, input.profileId),
        eq(
          tables.sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileVersion,
          input.toVersion,
        ),
      ),
    )
    .limit(1);

  if (existingTarget !== undefined) {
    const [updatedSchedule] = await tx
      .update(tables.schedules)
      .set({
        name: sourceSchedule.name,
        cronExpression: sourceSchedule.cronExpression,
        timezone: sourceSchedule.timezone,
        enabled: sourceSchedule.enabled,
        nextScheduledAt: nextOccurrence.scheduledAt.toISOString(),
        deletedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.schedules.id, existingTarget.scheduleId))
      .returning({
        id: tables.schedules.id,
        name: tables.schedules.name,
        cronExpression: tables.schedules.cronExpression,
        timezone: tables.schedules.timezone,
        enabled: tables.schedules.enabled,
        nextScheduledAt: tables.schedules.nextScheduledAt,
      });

    if (updatedSchedule === undefined) {
      throw new Error("Expected existing snapshot refresh schedule to be updated.");
    }
    if (updatedSchedule.cronExpression === null) {
      throw new Error("Updated snapshot refresh schedule is missing cron_expression.");
    }
    if (updatedSchedule.timezone === null) {
      throw new Error("Updated snapshot refresh schedule is missing timezone.");
    }

    return {
      scheduleId: updatedSchedule.id,
      name: updatedSchedule.name,
      cronExpression: updatedSchedule.cronExpression,
      timezone: updatedSchedule.timezone,
      enabled: updatedSchedule.enabled,
      nextScheduledAt: updatedSchedule.nextScheduledAt,
    };
  }

  const [createdSchedule] = await tx
    .insert(tables.schedules)
    .values({
      organizationId: input.organizationId,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name: sourceSchedule.name,
      cronExpression: sourceSchedule.cronExpression,
      timezone: sourceSchedule.timezone,
      enabled: sourceSchedule.enabled,
      nextScheduledAt: nextOccurrence.scheduledAt.toISOString(),
    })
    .returning({
      id: tables.schedules.id,
      name: tables.schedules.name,
      cronExpression: tables.schedules.cronExpression,
      timezone: tables.schedules.timezone,
      enabled: tables.schedules.enabled,
      nextScheduledAt: tables.schedules.nextScheduledAt,
    });

  if (createdSchedule === undefined) {
    throw new Error("Expected copied snapshot refresh schedule to be created.");
  }
  if (createdSchedule.cronExpression === null) {
    throw new Error("Copied snapshot refresh schedule is missing cron_expression.");
  }
  if (createdSchedule.timezone === null) {
    throw new Error("Copied snapshot refresh schedule is missing timezone.");
  }

  await tx.insert(tables.sandboxProfileSnapshotRefreshScheduleTargets).values({
    scheduleId: createdSchedule.id,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.toVersion,
  });

  return {
    scheduleId: createdSchedule.id,
    name: createdSchedule.name,
    cronExpression: createdSchedule.cronExpression,
    timezone: createdSchedule.timezone,
    enabled: createdSchedule.enabled,
    nextScheduledAt: createdSchedule.nextScheduledAt,
  };
}

export async function publishProfileVersion(
  {
    db,
    dataPlaneClient,
    defaultBaseImage,
    integrationRegistry,
    sandboxConfig,
  }: Pick<
    CreateSandboxProfilesServiceInput,
    "db" | "dataPlaneClient" | "integrationRegistry" | "sandboxConfig"
  > & {
    defaultBaseImage: string;
  },
  input: PublishProfileVersionInput,
): Promise<PublishProfileVersionOutput> {
  const sandboxInstanceId = typeid("sbi").toString();

  const publishedResult = await db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

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
        maintenanceScript: true,
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

    if (sandboxProfileVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const publishability = await getProfileVersionPublishability(
      {
        db: tx,
        integrationRegistry,
        sandboxConfig,
      },
      input,
    );

    if (!publishability.publishable) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_PUBLISHABLE,
        `Sandbox profile version '${String(input.profileVersion)}' is not publishable.`,
      );
    }

    const previousActiveVersionNumber = sandboxProfile.activeVersion;
    let previousActiveVersion: { maintenanceScript: string | null } | null = null;
    if (previousActiveVersionNumber !== null) {
      const activeVersion = previousActiveVersionNumber;
      previousActiveVersion =
        (await tx.query.sandboxProfileVersions.findFirst({
          columns: {
            maintenanceScript: true,
          },
          where: (table, { and: whereAnd, eq: whereEq }) =>
            whereAnd(
              whereEq(table.sandboxProfileId, input.profileId),
              whereEq(table.version, activeVersion),
            ),
        })) ?? null;
    }

    const [publishedVersion] = await tx
      .update(tables.sandboxProfileVersions)
      .set({
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: sql`now()`,
        maintenanceScript:
          previousActiveVersion === null
            ? sandboxProfileVersion.maintenanceScript
            : previousActiveVersion.maintenanceScript,
      })
      .where(
        and(
          eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
          eq(tables.sandboxProfileVersions.version, input.profileVersion),
          eq(tables.sandboxProfileVersions.state, SandboxProfileVersionStates.DRAFT),
        ),
      )
      .returning({
        sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
        version: tables.sandboxProfileVersions.version,
        state: tables.sandboxProfileVersions.state,
        publishedAt: tables.sandboxProfileVersions.publishedAt,
        agentRuntimeId: tables.sandboxProfileVersions.agentRuntimeId,
        gitCommitSigningIntegrationConnectionId:
          tables.sandboxProfileVersions.gitCommitSigningIntegrationConnectionId,
        mistleMcpEnabled: tables.sandboxProfileVersions.mistleMcpEnabled,
        mistleMcpApiKeyId: tables.sandboxProfileVersions.mistleMcpApiKeyId,
        sandboxProvider: tables.sandboxProfileVersions.sandboxProvider,
        sandboxConnectionId: tables.sandboxProfileVersions.sandboxConnectionId,
        sandboxVcpuCount: tables.sandboxProfileVersions.sandboxVcpuCount,
        sandboxMemoryMb: tables.sandboxProfileVersions.sandboxMemoryMb,
        sandboxStorageMb: tables.sandboxProfileVersions.sandboxStorageMb,
        maintenanceScript: tables.sandboxProfileVersions.maintenanceScript,
        skillsConfig: tables.sandboxProfileVersions.skillsConfig,
      });

    if (publishedVersion === undefined) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const [snapshotJob] = await tx
      .insert(tables.sandboxProfileVersionSnapshotJobs)
      .values({
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: input.profileVersion,
        sandboxInstanceId,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
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

    const refreshSchedulesByVersion = await loadActiveRefreshSchedulesByVersion({
      db: tx,
      profileId: input.profileId,
    });
    const copiedRefreshSchedule =
      previousActiveVersionNumber === null
        ? null
        : await copyRefreshScheduleToPublishedVersion(tx, {
            organizationId: input.organizationId,
            profileId: input.profileId,
            fromVersion: previousActiveVersionNumber,
            toVersion: input.profileVersion,
            now: new Date(),
          });

    return {
      version: {
        sandboxProfileId: publishedVersion.sandboxProfileId,
        version: publishedVersion.version,
        state: publishedVersion.state,
        publishedAt: publishedVersion.publishedAt,
        agentRuntimeId: publishedVersion.agentRuntimeId,
        gitCommitSigningIntegrationConnectionId:
          publishedVersion.gitCommitSigningIntegrationConnectionId,
        mistleMcpEnabled: publishedVersion.mistleMcpEnabled,
        mistleMcpApiKeyId: publishedVersion.mistleMcpApiKeyId,
        maintenanceScript: publishedVersion.maintenanceScript,
        ...mapProfileVersionRuntimeConfig(publishedVersion),
        skillsConfig: mapProfileVersionSkillsConfig(publishedVersion.skillsConfig),
        isActive: false,
        usable: false,
        refreshSchedule:
          copiedRefreshSchedule ?? refreshSchedulesByVersion.get(input.profileVersion) ?? null,
        latestSnapshotJob: snapshotJob,
      },
      activeVersion: sandboxProfile.activeVersion,
      snapshotJob,
    };
  });

  const sandboxRuntime = createWorkflowSandboxRuntime(publishedResult.version);
  await enqueueSnapshotMaterializationJob(
    {
      db,
      dataPlaneClient,
    },
    {
      snapshotJobId: publishedResult.snapshotJob.id,
      sandboxInstanceId,
      organizationId: input.organizationId,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
      snapshotPreparationScriptKind: "setup",
      image: {
        imageId: defaultBaseImage,
        createdAt: new Date().toISOString(),
        kind: "base",
        provider: sandboxRuntime.provider,
      },
      sandboxRuntime,
    },
  );

  return publishedResult;
}
