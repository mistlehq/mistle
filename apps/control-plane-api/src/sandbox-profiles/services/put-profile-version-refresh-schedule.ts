import {
  getControlPlaneDatabaseSchema,
  type ControlPlaneTables,
  type ControlPlaneTransaction,
  ScheduleKinds,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import { findNextScheduleOccurrence } from "@mistle/time";
import { and, eq, sql } from "drizzle-orm";

import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { lockProfileVersionForUpdateOrThrow } from "./lock-profile-version-for-update.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

const DefaultRefreshScheduleName = "Sandbox profile version refresh";

export type PutProfileVersionRefreshScheduleInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  name?: string | undefined;
  cronExpression: string;
  timezone: string;
  maintenanceScript?: string | null | undefined;
  now: Date;
};

export type ProfileVersionRefreshSchedule = {
  scheduleId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  name: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  nextScheduledAt: string | null;
};

type ExistingRefreshSchedule = {
  scheduleId: string;
};

export async function putProfileVersionRefreshSchedule(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PutProfileVersionRefreshScheduleInput,
): Promise<ProfileVersionRefreshSchedule> {
  const occurrence = resolveInitialOccurrence(input);
  const tables = getControlPlaneDatabaseSchema(db);

  return db.transaction(async (tx) => {
    await lockProfileAndVersion(tx, tables, input);
    if (input.maintenanceScript !== undefined) {
      await updateProfileVersionMaintenanceScript(tx, tables, {
        maintenanceScript: input.maintenanceScript,
        profileId: input.profileId,
        profileVersion: input.profileVersion,
      });
    }
    const existingSchedule = await findRefreshScheduleForProfileVersion(tx, tables, input);

    if (existingSchedule === null) {
      return createRefreshSchedule(tx, tables, {
        ...input,
        nextScheduledAt: occurrence.scheduledAt.toISOString(),
      });
    }

    return updateRefreshSchedule(tx, tables, {
      ...input,
      scheduleId: existingSchedule.scheduleId,
      nextScheduledAt: occurrence.scheduledAt.toISOString(),
    });
  });
}

async function updateProfileVersionMaintenanceScript(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    profileId: string;
    profileVersion: number;
    maintenanceScript: string | null;
  },
): Promise<void> {
  await tx
    .update(tables.sandboxProfileVersions)
    .set({
      maintenanceScript: input.maintenanceScript,
    })
    .where(
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
        eq(tables.sandboxProfileVersions.version, input.profileVersion),
      ),
    );
}

function resolveInitialOccurrence(input: PutProfileVersionRefreshScheduleInput): {
  scheduledAt: Date;
} {
  try {
    const occurrence = findNextScheduleOccurrence({
      after: input.now,
      cronExpression: input.cronExpression,
      timezone: input.timezone,
    });
    if (occurrence === null) {
      throw new Error("Schedule has no next occurrence.");
    }

    return {
      scheduledAt: occurrence.scheduledAt,
    };
  } catch (error) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_REFRESH_SCHEDULE,
      error instanceof Error ? error.message : "Invalid refresh schedule.",
    );
  }
}

async function lockProfileAndVersion(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
  },
): Promise<void> {
  const profile = await tx.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.profileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (profile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  await lockProfileVersionForUpdateOrThrow({
    db: tx,
    tables,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
  });
}

async function findRefreshScheduleForProfileVersion(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: {
    profileId: string;
    profileVersion: number;
  },
): Promise<ExistingRefreshSchedule | null> {
  const scheduleTargets = tables.sandboxProfileSnapshotRefreshScheduleTargets;
  const [target] = await tx
    .select({
      scheduleId: scheduleTargets.scheduleId,
    })
    .from(scheduleTargets)
    .where(
      and(
        eq(scheduleTargets.sandboxProfileId, input.profileId),
        eq(scheduleTargets.sandboxProfileVersion, input.profileVersion),
      ),
    )
    .limit(1);

  return target ?? null;
}

async function createRefreshSchedule(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: PutProfileVersionRefreshScheduleInput & {
    nextScheduledAt: string;
  },
): Promise<ProfileVersionRefreshSchedule> {
  const name = input.name ?? DefaultRefreshScheduleName;
  const scheduleTargets = tables.sandboxProfileSnapshotRefreshScheduleTargets;
  const [schedule] = await tx
    .insert(tables.schedules)
    .values({
      organizationId: input.organizationId,
      kind: ScheduleKinds.RECURRING,
      targetType: ScheduleTargetTypes.SNAPSHOT_REFRESH,
      name,
      cronExpression: input.cronExpression,
      timezone: input.timezone,
      enabled: true,
      nextScheduledAt: input.nextScheduledAt,
    })
    .returning({
      id: tables.schedules.id,
      name: tables.schedules.name,
      cronExpression: tables.schedules.cronExpression,
      timezone: tables.schedules.timezone,
      enabled: tables.schedules.enabled,
      nextScheduledAt: tables.schedules.nextScheduledAt,
    });

  if (schedule === undefined) {
    throw new Error("Expected snapshot refresh schedule to be created.");
  }

  await tx.insert(scheduleTargets).values({
    scheduleId: schedule.id,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
  });

  return toRefreshScheduleResponse({
    schedule,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
  });
}

async function updateRefreshSchedule(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: PutProfileVersionRefreshScheduleInput & {
    scheduleId: string;
    nextScheduledAt: string;
  },
): Promise<ProfileVersionRefreshSchedule> {
  const name = input.name ?? DefaultRefreshScheduleName;
  const currentSchedule = await tx.query.schedules.findFirst({
    columns: {
      cronExpression: true,
      timezone: true,
      enabled: true,
      deletedAt: true,
      nextScheduledAt: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, input.scheduleId),
  });
  if (currentSchedule === undefined) {
    throw new Error(`Expected snapshot refresh schedule '${input.scheduleId}' to exist.`);
  }

  const scheduleDefinitionIsUnchanged =
    currentSchedule.enabled &&
    currentSchedule.deletedAt === null &&
    currentSchedule.cronExpression === input.cronExpression &&
    currentSchedule.timezone === input.timezone;
  const [schedule] = await tx
    .update(tables.schedules)
    .set({
      name,
      kind: ScheduleKinds.RECURRING,
      cronExpression: input.cronExpression,
      timezone: input.timezone,
      enabled: true,
      nextScheduledAt: scheduleDefinitionIsUnchanged
        ? currentSchedule.nextScheduledAt
        : input.nextScheduledAt,
      deletedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(tables.schedules.id, input.scheduleId))
    .returning({
      id: tables.schedules.id,
      name: tables.schedules.name,
      cronExpression: tables.schedules.cronExpression,
      timezone: tables.schedules.timezone,
      enabled: tables.schedules.enabled,
      nextScheduledAt: tables.schedules.nextScheduledAt,
    });

  if (schedule === undefined) {
    throw new Error(`Expected snapshot refresh schedule '${input.scheduleId}' to be updated.`);
  }

  return toRefreshScheduleResponse({
    schedule,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
  });
}

function toRefreshScheduleResponse(input: {
  schedule: {
    id: string;
    name: string;
    cronExpression: string | null;
    timezone: string | null;
    enabled: boolean;
    nextScheduledAt: string | null;
  };
  profileId: string;
  profileVersion: number;
}): ProfileVersionRefreshSchedule {
  if (input.schedule.cronExpression === null) {
    throw new Error(`Recurring schedule '${input.schedule.id}' is missing cron_expression.`);
  }
  if (input.schedule.timezone === null) {
    throw new Error(`Recurring schedule '${input.schedule.id}' is missing timezone.`);
  }

  return {
    scheduleId: input.schedule.id,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    name: input.schedule.name,
    cronExpression: input.schedule.cronExpression,
    timezone: input.schedule.timezone,
    enabled: input.schedule.enabled,
    nextScheduledAt: input.schedule.nextScheduledAt,
  };
}
