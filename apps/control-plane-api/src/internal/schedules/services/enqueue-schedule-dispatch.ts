import type { Clock } from "@mistle/time";
import { ScheduleDispatchWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import type { OpenWorkflow } from "openworkflow";

import {
  createScheduleDispatchIdempotencyKey,
  resolveDispatchCutoffMinute,
} from "./dispatch-cutoff.js";

const DispatchCutoffSkewSeconds = 0;

export type EnqueueScheduleDispatchResult = Readonly<{
  status: "queued";
  cutoffMinute: string;
  idempotencyKey: string;
}>;

export async function enqueueScheduleDispatch(ctx: {
  clock: Clock;
  openWorkflow: OpenWorkflow;
}): Promise<EnqueueScheduleDispatchResult> {
  const cutoffMinute = resolveDispatchCutoffMinute({
    now: ctx.clock.nowDate(),
    cutoffSkewSeconds: DispatchCutoffSkewSeconds,
  });
  const idempotencyKey = createScheduleDispatchIdempotencyKey(cutoffMinute);

  await ctx.openWorkflow.runWorkflow(
    ScheduleDispatchWorkflowSpec,
    {
      cutoffMinute,
    },
    {
      idempotencyKey,
    },
  );

  return {
    status: "queued",
    cutoffMinute,
    idempotencyKey,
  };
}
