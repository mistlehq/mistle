import {
  type ControlPlaneTables,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { SandboxProfilesNotFoundCodes, SandboxProfilesNotFoundError } from "../errors.js";
import { lockProfileVersionForUpdateOrThrow } from "./lock-profile-version-for-update.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

export type DeleteProfileVersionRefreshScheduleInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
};

export type DeleteProfileVersionRefreshScheduleOutput = {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  deleted: boolean;
};

export async function deleteProfileVersionRefreshSchedule(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: DeleteProfileVersionRefreshScheduleInput,
): Promise<DeleteProfileVersionRefreshScheduleOutput> {
  return db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    await lockProfileAndVersion(tx, tables, input);

    const target = await tx.query.sandboxProfileSnapshotRefreshScheduleTargets.findFirst({
      columns: {
        scheduleId: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.sandboxProfileId, input.profileId),
          whereEq(table.sandboxProfileVersion, input.profileVersion),
        ),
    });

    if (target === undefined) {
      return {
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: input.profileVersion,
        deleted: false,
      };
    }

    await tx
      .update(tables.schedules)
      .set({
        enabled: false,
        nextScheduledAt: null,
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.schedules.id, target.scheduleId));

    return {
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      deleted: true,
    };
  });
}

async function lockProfileAndVersion(
  tx: ControlPlaneTransaction,
  tables: ControlPlaneTables,
  input: DeleteProfileVersionRefreshScheduleInput,
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

export async function softDeleteSnapshotRefreshSchedulesForProfileVersion(
  tx: ControlPlaneTransaction,
  input: {
    tables: ControlPlaneTables;
    profileId: string;
    profileVersion: number;
  },
): Promise<void> {
  const scheduleTargets = input.tables.sandboxProfileSnapshotRefreshScheduleTargets;
  const scheduleTable = input.tables.schedules;

  const targets = await tx
    .select({
      scheduleId: scheduleTargets.scheduleId,
    })
    .from(scheduleTargets)
    .where(
      and(
        eq(scheduleTargets.sandboxProfileId, input.profileId),
        eq(scheduleTargets.sandboxProfileVersion, input.profileVersion),
      ),
    );

  for (const target of targets) {
    await tx
      .update(scheduleTable)
      .set({
        enabled: false,
        nextScheduledAt: null,
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(scheduleTable.id, target.scheduleId));
  }
}
