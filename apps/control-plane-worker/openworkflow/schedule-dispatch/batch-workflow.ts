import { ScheduleDispatchBatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import {
  createScheduleDispatchBatchIdempotencyKey,
  ScheduleDispatchChildConcurrency,
  StaleScheduleDispatchAfterMs,
} from "./batches.js";
import { dispatchScheduledAction } from "./dispatch-scheduled-action.js";

export const ScheduleDispatchBatchWorkflow = defineTracedControlPlaneWorkflow(
  ScheduleDispatchBatchWorkflowSpec,
  async ({ input, run, step }) => {
    const sortedActionIds = [...input.scheduledActionIds].sort();
    if (sortedActionIds.length === 0) {
      return {
        scheduledActionIds: sortedActionIds,
      };
    }

    const dispatchClaimKey = createScheduleDispatchBatchIdempotencyKey(sortedActionIds);
    const staleDispatchingBefore = new Date(run.createdAt.getTime() - StaleScheduleDispatchAfterMs);
    const { dataPlaneClient, db, defaultBaseImage, openWorkflow } = await getWorkflowContext();

    for (let index = 0; index < sortedActionIds.length; index += ScheduleDispatchChildConcurrency) {
      const scheduledActionSlice = sortedActionIds.slice(
        index,
        index + ScheduleDispatchChildConcurrency,
      );
      await Promise.all(
        scheduledActionSlice.map((scheduledActionId) =>
          step.run(
            {
              name: createScheduledActionDispatchStepName(scheduledActionId),
            },
            async () =>
              dispatchScheduledAction(
                {
                  dataPlaneClient,
                  db,
                  defaultBaseImage,
                  openWorkflow,
                },
                {
                  scheduledActionId,
                  dispatchClaimKey,
                  staleDispatchingBefore,
                },
              ),
          ),
        ),
      );
    }

    return {
      scheduledActionIds: sortedActionIds,
    };
  },
);

export function createScheduledActionDispatchStepName(scheduledActionId: string): string {
  return `dispatch-scheduled-action:${scheduledActionId}`;
}
