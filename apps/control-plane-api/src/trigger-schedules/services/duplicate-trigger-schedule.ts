import { type ControlPlaneDatabase, ScheduleKinds } from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import type { OpenWorkflow } from "openworkflow";

import { TriggerSchedulesBadRequestCodes } from "../constants.js";
import { createTriggerSchedule } from "./create-trigger-schedule.js";
import { loadScheduleTriggerAggregateOrThrow } from "./load-schedule-trigger-aggregate-or-throw.js";

export async function duplicateTriggerSchedule(
  ctx: {
    db: ControlPlaneDatabase;
    openWorkflow: Pick<OpenWorkflow, "runWorkflow">;
  },
  input: {
    organizationId: string;
    triggerId: string;
    now: Date;
  },
) {
  const sourceTrigger = await loadScheduleTriggerAggregateOrThrow(
    { db: ctx.db },
    {
      organizationId: input.organizationId,
      triggerId: input.triggerId,
    },
  );

  if (sourceTrigger.schedule.kind === ScheduleKinds.ONE_OFF) {
    throw new BadRequestError(
      TriggerSchedulesBadRequestCodes.UNSUPPORTED_DUPLICATE_SCHEDULE_KIND,
      "One-off scheduled triggers cannot be duplicated.",
    );
  }
  if (sourceTrigger.schedule.cronExpression === null || sourceTrigger.schedule.timezone === null) {
    throw new Error(`Recurring scheduled trigger '${sourceTrigger.id}' is missing timing fields.`);
  }

  return await createTriggerSchedule(ctx, {
    organizationId: input.organizationId,
    name: `${sourceTrigger.name} copy`,
    enabled: false,
    schedule: {
      kind: "recurring",
      name: sourceTrigger.schedule.name,
      cronExpression: sourceTrigger.schedule.cronExpression,
      timezone: sourceTrigger.schedule.timezone,
    },
    inputTemplate: sourceTrigger.inputTemplate,
    conversationKeyTemplate: sourceTrigger.conversationKeyTemplate,
    idempotencyKeyTemplate: sourceTrigger.idempotencyKeyTemplate,
    target: {
      sandboxProfileId: sourceTrigger.target.sandboxProfileId,
      sandboxProfileVersion: sourceTrigger.target.sandboxProfileVersion,
      primaryRepositoryId: sourceTrigger.target.primaryRepositoryId,
    },
    now: input.now,
  });
}
