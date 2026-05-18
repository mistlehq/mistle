import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import { ScheduleActionFailureCodes } from "../constants.js";
import { loadScheduleTriggerAggregateOrThrow } from "./load-schedule-trigger-aggregate-or-throw.js";
import { failPendingScheduledActions } from "./update-trigger-schedule.js";

export type DeleteScheduleTriggerInput = {
  organizationId: string;
  triggerId: string;
};

export async function deleteTriggerSchedule(
  ctx: { db: ControlPlaneDatabase },
  input: DeleteScheduleTriggerInput,
) {
  const existingTrigger = await loadScheduleTriggerAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      triggerId: input.triggerId,
    },
  );

  await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    await tx
      .update(tables.triggers)
      .set({
        enabled: false,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.triggers.id, input.triggerId));

    await tx
      .update(tables.schedules)
      .set({
        enabled: false,
        nextScheduledAt: null,
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.schedules.id, existingTrigger.schedule.id));

    await failPendingScheduledActions(tx, {
      scheduleId: existingTrigger.schedule.id,
      failureCode: ScheduleActionFailureCodes.SCHEDULE_DELETED,
      failureMessage: "Schedule was deleted before the action was dispatched.",
    });
  });
}
