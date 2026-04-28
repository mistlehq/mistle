import { ScheduleDispatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { dispatchDueSchedules } from "./dispatch-due-schedules.js";
import { startScheduleDispatchChildBatches } from "./start-child-batches.js";
import {
  recordBacklogFastForwarded,
  recordDueSchedulesClaimed,
  recordMaxBatchesReached,
  recordScheduleDispatchWorkflowDuration,
  recordScheduleDispatchWorkflowStarted,
  recordScheduledActionsCreated,
  recordSkippedLateScheduledActions,
} from "./telemetry.js";

export const ScheduleDispatchWorkflow = defineTracedControlPlaneWorkflow(
  ScheduleDispatchWorkflowSpec,
  async ({ input, step }) => {
    recordScheduleDispatchWorkflowStarted();
    const workflowStartedAtMs = Date.now();

    try {
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
      recordDueSchedulesClaimed(dispatchResult.claimedScheduleCount);
      recordScheduledActionsCreated(dispatchResult.createdScheduledActionCount);
      recordSkippedLateScheduledActions(dispatchResult.skippedLateCount);
      recordBacklogFastForwarded(dispatchResult.backlogFastForwardedCount);
      if (dispatchResult.reachedMaxBatches) {
        recordMaxBatchesReached({
          claimedScheduleCount: dispatchResult.claimedScheduleCount,
          cutoffMinute,
        });
      }

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
    } finally {
      recordScheduleDispatchWorkflowDuration(Date.now() - workflowStartedAtMs);
    }
  },
);
