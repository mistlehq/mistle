import {
  type ControlPlaneTransaction,
  sandboxProfileSnapshotRefreshScheduleTargets,
  schedules,
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
    await lockProfileAndVersion(tx, input);

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
      .update(schedules)
      .set({
        enabled: false,
        nextScheduledAt: null,
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schedules.id, target.scheduleId));

    return {
      sandboxProfileId: input.profileId,
      sandboxProfileVersion: input.profileVersion,
      deleted: true,
    };
  });
}

async function lockProfileAndVersion(
  tx: ControlPlaneTransaction,
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
    profileId: input.profileId,
    profileVersion: input.profileVersion,
  });
}

export async function softDeleteSnapshotRefreshSchedulesForProfileVersion(
  tx: ControlPlaneTransaction,
  input: {
    profileId: string;
    profileVersion: number;
  },
): Promise<void> {
  const targets = await tx
    .select({
      scheduleId: sandboxProfileSnapshotRefreshScheduleTargets.scheduleId,
    })
    .from(sandboxProfileSnapshotRefreshScheduleTargets)
    .where(
      and(
        eq(sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileId, input.profileId),
        eq(
          sandboxProfileSnapshotRefreshScheduleTargets.sandboxProfileVersion,
          input.profileVersion,
        ),
      ),
    );

  for (const target of targets) {
    await tx
      .update(schedules)
      .set({
        enabled: false,
        nextScheduledAt: null,
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schedules.id, target.scheduleId));
  }
}
