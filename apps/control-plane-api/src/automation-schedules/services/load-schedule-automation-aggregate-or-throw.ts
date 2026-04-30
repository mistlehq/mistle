import {
  AutomationKinds,
  ScheduleTargetTypes,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";

export type AutomationScheduleAggregate = {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  schedule: {
    id: string;
    name: string;
    cronExpression: string;
    timezone: string;
    enabled: boolean;
    nextScheduledAt: string | null;
    lastScheduledAt: string | null;
  };
  inputTemplate: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  target: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
};

export async function loadScheduleAutomationAggregateOrThrow(
  ctx: { db: ControlPlaneDatabase | ControlPlaneTransaction },
  input: {
    organizationId: string;
    automationId: string;
  },
): Promise<AutomationScheduleAggregate> {
  const automation = await ctx.db.query.automations.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, input.automationId),
        eq(table.organizationId, input.organizationId),
        eq(table.kind, AutomationKinds.SCHEDULE),
      ),
  });

  if (automation === undefined) {
    throw new NotFoundError("NOT_FOUND", "Scheduled automation was not found.");
  }

  const [scheduleAutomation, targets] = await Promise.all([
    ctx.db.query.scheduleAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, automation.id),
    }),
    ctx.db.query.automationTargets.findMany({
      where: (table, { eq }) => eq(table.automationId, automation.id),
    }),
  ]);

  if (scheduleAutomation === undefined) {
    throw new Error(
      `Scheduled automation '${automation.id}' is missing its schedule automation row.`,
    );
  }

  const schedule = await ctx.db.query.schedules.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.id, scheduleAutomation.scheduleId),
        eq(table.organizationId, input.organizationId),
        eq(table.targetType, ScheduleTargetTypes.AUTOMATION_RUN),
      ),
  });

  if (schedule === undefined) {
    throw new Error(`Scheduled automation '${automation.id}' is missing its schedule row.`);
  }

  if (schedule.deletedAt !== null) {
    throw new NotFoundError("NOT_FOUND", "Scheduled automation was not found.");
  }

  if (targets.length !== 1 || targets[0] === undefined) {
    throw new Error(
      `Scheduled automation '${automation.id}' must have exactly one automation target.`,
    );
  }

  const target = targets[0];

  return {
    id: automation.id,
    name: automation.name,
    enabled: automation.enabled,
    createdAt: automation.createdAt,
    updatedAt: automation.updatedAt,
    schedule: {
      id: schedule.id,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      enabled: schedule.enabled,
      nextScheduledAt: schedule.nextScheduledAt,
      lastScheduledAt: schedule.lastScheduledAt,
    },
    inputTemplate: scheduleAutomation.inputTemplate,
    conversationKeyTemplate: scheduleAutomation.conversationKeyTemplate,
    idempotencyKeyTemplate: scheduleAutomation.idempotencyKeyTemplate,
    target: {
      id: target.id,
      sandboxProfileId: target.sandboxProfileId,
      sandboxProfileVersion: target.sandboxProfileVersion,
      primaryRepositoryId: target.primaryRepositoryId,
    },
  };
}
