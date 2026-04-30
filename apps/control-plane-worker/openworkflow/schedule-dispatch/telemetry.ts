import { metrics, type Attributes } from "@opentelemetry/api";

import { logger } from "../../logger.js";

const ScheduleDispatchMeter = metrics.getMeter("@mistle/control-plane-worker/schedule-dispatch");

const ScheduleDispatchWorkflowStarted = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.workflow.started.count",
  {
    description: "Count of top-level schedule dispatch workflow executions started.",
  },
);

const ScheduleDispatchWorkflowDurationMs = ScheduleDispatchMeter.createHistogram(
  "mistle.schedule.dispatch.workflow.duration",
  {
    description: "Observed top-level schedule dispatch workflow duration.",
    unit: "ms",
  },
);

const ScheduleDispatchDueSchedulesClaimed = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.due_schedules.claimed.count",
  {
    description: "Count of due schedules claimed by the schedule dispatcher.",
  },
);

const ScheduleDispatchScheduledActionsCreated = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.scheduled_actions.created.count",
  {
    description: "Count of scheduled action rows created by the schedule dispatcher.",
  },
);

const ScheduleDispatchSkippedLate = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.scheduled_actions.skipped_late.count",
  {
    description: "Count of scheduled actions skipped because the catch-up window was exceeded.",
  },
);

const ScheduleDispatchBacklogFastForwarded = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.backlog.fast_forwarded.count",
  {
    description: "Count of schedule backlogs fast-forwarded after exceeding the catch-up window.",
  },
);

const ScheduleDispatchMissingTargets = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.targets.missing.count",
  {
    description: "Count of claimed schedules that could not resolve their target row.",
  },
);

const ScheduleDispatchRecoveredActions = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.scheduled_actions.recovered.count",
  {
    description: "Count of pending or stale dispatching scheduled actions recovered for dispatch.",
  },
);

const ScheduleDispatchChildWorkflowsStarted = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.child_workflows.started.count",
  {
    description: "Count of schedule dispatch child batch workflows started.",
  },
);

const ScheduleDispatchMaxBatchesReached = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.max_batches_reached.count",
  {
    description: "Count of schedule dispatch workflows that reached the per-run batch limit.",
  },
);

const ScheduleDispatchTargetHandoffFailures = ScheduleDispatchMeter.createCounter(
  "mistle.schedule.dispatch.target_handoff.failure.count",
  {
    description: "Count of scheduled action target handoff failures.",
  },
);

export function recordScheduleDispatchWorkflowStarted(): void {
  ScheduleDispatchWorkflowStarted.add(1);
}

export function recordScheduleDispatchWorkflowDuration(durationMs: number): void {
  ScheduleDispatchWorkflowDurationMs.record(durationMs);
}

export function recordDueSchedulesClaimed(count: number): void {
  addIfPositive(ScheduleDispatchDueSchedulesClaimed, count);
}

export function recordScheduledActionsCreated(count: number): void {
  addIfPositive(ScheduleDispatchScheduledActionsCreated, count);
}

export function recordSkippedLateScheduledActions(count: number): void {
  addIfPositive(ScheduleDispatchSkippedLate, count);
}

export function recordBacklogFastForwarded(count: number): void {
  addIfPositive(ScheduleDispatchBacklogFastForwarded, count);
}

export function recordMissingScheduleTarget(input: {
  scheduleId: string;
  targetType: string;
}): void {
  ScheduleDispatchMissingTargets.add(1, {
    target_type: input.targetType,
  });
  logger.warn(
    {
      eventName: "schedule.dispatch.target_missing",
      scheduleId: input.scheduleId,
      targetType: input.targetType,
    },
    "Schedule target row is missing; disabling schedule.",
  );
}

export function recordRecoveredScheduledActions(input: {
  pendingCount: number;
  staleDispatchingCount: number;
}): void {
  addIfPositive(ScheduleDispatchRecoveredActions, input.pendingCount, {
    status: "pending",
  });
  addIfPositive(ScheduleDispatchRecoveredActions, input.staleDispatchingCount, {
    status: "dispatching",
  });
}

export function recordChildWorkflowsStarted(count: number): void {
  addIfPositive(ScheduleDispatchChildWorkflowsStarted, count);
}

export function recordMaxBatchesReached(input: {
  claimedScheduleCount: number;
  cutoffMinute: Date;
}): void {
  ScheduleDispatchMaxBatchesReached.add(1);
  logger.warn(
    {
      claimedScheduleCount: input.claimedScheduleCount,
      cutoffMinute: input.cutoffMinute.toISOString(),
      eventName: "schedule.dispatch.max_batches_reached",
    },
    "Schedule dispatch reached the per-run batch limit.",
  );
}

export function recordScheduleTargetHandoffFailure(input: {
  error: unknown;
  scheduledActionId: string;
  scheduleId: string;
  targetType: string;
}): void {
  ScheduleDispatchTargetHandoffFailures.add(1, {
    target_type: input.targetType,
  });
  logger.error(
    {
      err: input.error,
      eventName: "schedule.dispatch.target_handoff_failed",
      scheduleId: input.scheduleId,
      scheduledActionId: input.scheduledActionId,
      targetType: input.targetType,
    },
    "Schedule target handoff failed.",
  );
}

function addIfPositive(
  counter: {
    add: (value: number, attributes?: Attributes) => void;
  },
  count: number,
  attributes?: Attributes,
): void {
  if (count > 0) {
    counter.add(count, attributes);
  }
}
