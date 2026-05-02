import type { ControlPlaneDatabase, ControlPlaneTables } from "@mistle/db/control-plane";
import { and, eq, inArray, sql } from "drizzle-orm";

export async function deleteSandboxProfile(
  ctx: {
    db: ControlPlaneDatabase;
    tables: ControlPlaneTables;
  },
  input: { organizationId: string; profileId: string },
): Promise<void> {
  const { sandboxProfiles, schedules } = ctx.tables;

  await ctx.db.transaction(async (tx) => {
    const refreshScheduleTargets =
      await tx.query.sandboxProfileSnapshotRefreshScheduleTargets.findMany({
        columns: {
          scheduleId: true,
        },
        where: (table, { eq }) => eq(table.sandboxProfileId, input.profileId),
      });
    const refreshScheduleIds = refreshScheduleTargets.map((target) => target.scheduleId);

    if (refreshScheduleIds.length > 0) {
      await tx
        .update(schedules)
        .set({
          enabled: false,
          nextScheduledAt: null,
          deletedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(schedules.id, refreshScheduleIds));
    }

    await tx
      .delete(sandboxProfiles)
      .where(
        and(
          eq(sandboxProfiles.id, input.profileId),
          eq(sandboxProfiles.organizationId, input.organizationId),
        ),
      );
  });
}
