import { automations, type ControlPlaneDatabase, schedules } from "@mistle/db/control-plane";
import { eq, sql } from "drizzle-orm";

import { ScheduleActionFailureCodes } from "../constants.js";
import { loadScheduleAutomationAggregateOrThrow } from "./load-schedule-automation-aggregate-or-throw.js";
import { failPendingScheduledActions } from "./update-automation-schedule.js";

export type DeleteScheduleAutomationInput = {
  organizationId: string;
  automationId: string;
};

export async function deleteAutomationSchedule(
  ctx: { db: ControlPlaneDatabase },
  input: DeleteScheduleAutomationInput,
) {
  const existingAutomation = await loadScheduleAutomationAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      automationId: input.automationId,
    },
  );

  await ctx.db.transaction(async (tx) => {
    await tx
      .update(automations)
      .set({
        enabled: false,
        updatedAt: sql`now()`,
      })
      .where(eq(automations.id, input.automationId));

    await tx
      .update(schedules)
      .set({
        enabled: false,
        nextScheduledAt: null,
        deletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(schedules.id, existingAutomation.schedule.id));

    await failPendingScheduledActions(tx, {
      scheduleId: existingAutomation.schedule.id,
      failureCode: ScheduleActionFailureCodes.SCHEDULE_DELETED,
      failureMessage: "Schedule was deleted before the action was dispatched.",
    });
  });
}
