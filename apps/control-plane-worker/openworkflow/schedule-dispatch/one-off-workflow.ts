import { DispatchOneOffScheduleWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { StaleScheduleDispatchAfterMs } from "./batches.js";
import {
  createOneOffScheduledAction,
  finalizeDispatchedOneOffSchedule,
} from "./dispatch-one-off-schedule.js";
import { dispatchScheduledAction } from "./dispatch-scheduled-action.js";

export const DispatchOneOffScheduleWorkflow = defineTracedControlPlaneWorkflow(
  DispatchOneOffScheduleWorkflowSpec,
  async ({ input, run, step }) => {
    const { dataPlaneClient, db, defaultBaseImage, openWorkflow } = await getWorkflowContext();

    const scheduledAction = await step.run({ name: "create-one-off-scheduled-action" }, async () =>
      createOneOffScheduledAction(
        {
          db,
        },
        {
          scheduleId: input.scheduleId,
        },
      ),
    );

    if (scheduledAction.status === "skipped" || scheduledAction.status === "failed") {
      return {
        scheduleId: scheduledAction.scheduleId,
        scheduledActionId: scheduledAction.scheduledActionId,
        status: scheduledAction.status,
      };
    }

    const dispatchResult = await step.run({ name: "dispatch-one-off-scheduled-action" }, async () =>
      dispatchScheduledAction(
        {
          dataPlaneClient,
          db,
          defaultBaseImage,
          openWorkflow,
        },
        {
          scheduledActionId: scheduledAction.scheduledActionId,
          dispatchClaimKey: createOneOffScheduleDispatchClaimKey({
            scheduleId: input.scheduleId,
            scheduledActionId: scheduledAction.scheduledActionId,
          }),
          staleDispatchingBefore: new Date(run.createdAt.getTime() - StaleScheduleDispatchAfterMs),
        },
      ),
    );

    await step.run({ name: "finalize-one-off-schedule" }, async () =>
      finalizeDispatchedOneOffSchedule(
        {
          db,
        },
        {
          scheduleId: scheduledAction.scheduleId,
          scheduledAt: scheduledAction.scheduledAt,
        },
      ),
    );

    const status: "dispatched" | "failed" =
      dispatchResult.status === "failed" ? "failed" : "dispatched";

    return {
      scheduleId: scheduledAction.scheduleId,
      scheduledActionId: scheduledAction.scheduledActionId,
      status,
    };
  },
);

function createOneOffScheduleDispatchClaimKey(input: {
  scheduleId: string;
  scheduledActionId: string;
}): string {
  return `one-off-schedule:${input.scheduleId}:${input.scheduledActionId}`;
}
