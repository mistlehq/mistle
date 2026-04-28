import { ScheduleDispatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { dispatchDueSchedules } from "./dispatch-due-schedules.js";
import { startScheduleDispatchChildBatches } from "./start-child-batches.js";

export const ScheduleDispatchWorkflow = defineTracedControlPlaneWorkflow(
  ScheduleDispatchWorkflowSpec,
  async ({ input, step }) => {
    const cutoffMinute = new Date(input.cutoffMinute);
    if (Number.isNaN(cutoffMinute.getTime())) {
      throw new Error(`Invalid schedule dispatch cutoff minute: ${input.cutoffMinute}`);
    }

    const { db, openWorkflow } = await getWorkflowContext();

    await step.run({ name: "recover-scheduled-actions-before-dispatch" }, async () =>
      startScheduleDispatchChildBatches(
        {
          db,
          openWorkflow,
        },
        {
          cutoffMinute,
          scheduledActionIds: [],
        },
      ),
    );

    const dispatchResult = await step.run({ name: "dispatch-due-schedules" }, async () =>
      dispatchDueSchedules(
        {
          db,
        },
        {
          cutoffMinute,
        },
      ),
    );

    await step.run({ name: "start-schedule-dispatch-child-batches" }, async () =>
      startScheduleDispatchChildBatches(
        {
          db,
          openWorkflow,
        },
        {
          cutoffMinute,
          scheduledActionIds: dispatchResult.pendingScheduledActionIds,
        },
      ),
    );

    return dispatchResult;
  },
);
