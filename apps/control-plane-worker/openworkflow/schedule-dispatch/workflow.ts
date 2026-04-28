import { ScheduleDispatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { dispatchDueSchedules } from "./dispatch-due-schedules.js";

export const ScheduleDispatchWorkflow = defineTracedControlPlaneWorkflow(
  ScheduleDispatchWorkflowSpec,
  async ({ input, step }) => {
    const cutoffMinute = new Date(input.cutoffMinute);
    if (Number.isNaN(cutoffMinute.getTime())) {
      throw new Error(`Invalid schedule dispatch cutoff minute: ${input.cutoffMinute}`);
    }

    const { db } = await getWorkflowContext();

    return step.run({ name: "dispatch-due-schedules" }, async () =>
      dispatchDueSchedules(
        {
          db,
        },
        {
          cutoffMinute,
        },
      ),
    );
  },
);
