import { ScheduleKinds } from "@mistle/db/control-plane";

import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type ProfileVersionRefreshScheduleSummary = {
  scheduleId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  nextScheduledAt: string | null;
};

export async function loadActiveRefreshSchedulesByVersion(
  input: Pick<CreateSandboxProfilesServiceInput, "db"> & {
    profileId: string;
  },
): Promise<Map<number, ProfileVersionRefreshScheduleSummary>> {
  const targets = await input.db.query.sandboxProfileSnapshotRefreshScheduleTargets.findMany({
    columns: {
      scheduleId: true,
      sandboxProfileVersion: true,
    },
    where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
  });

  if (targets.length === 0) {
    return new Map();
  }

  const schedules = await input.db.query.schedules.findMany({
    columns: {
      id: true,
      name: true,
      cronExpression: true,
      timezone: true,
      enabled: true,
      nextScheduledAt: true,
    },
    where: (table, { and, eq, inArray, isNull }) =>
      and(
        inArray(
          table.id,
          targets.map((target) => target.scheduleId),
        ),
        eq(table.kind, ScheduleKinds.RECURRING),
        eq(table.enabled, true),
        isNull(table.deletedAt),
      ),
  });
  const schedulesById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const refreshSchedulesByVersion = new Map<number, ProfileVersionRefreshScheduleSummary>();

  for (const target of targets) {
    const schedule = schedulesById.get(target.scheduleId);
    if (schedule === undefined) {
      continue;
    }

    if (refreshSchedulesByVersion.has(target.sandboxProfileVersion)) {
      throw new Error(
        `Sandbox profile '${input.profileId}' version '${String(
          target.sandboxProfileVersion,
        )}' has multiple active refresh schedules.`,
      );
    }
    if (schedule.cronExpression === null) {
      throw new Error(`Recurring schedule '${schedule.id}' is missing cron_expression.`);
    }
    if (schedule.timezone === null) {
      throw new Error(`Recurring schedule '${schedule.id}' is missing timezone.`);
    }

    refreshSchedulesByVersion.set(target.sandboxProfileVersion, {
      scheduleId: schedule.id,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      nextScheduledAt: schedule.nextScheduledAt,
    });
  }

  return refreshSchedulesByVersion;
}
