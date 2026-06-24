import {
  TriggerKinds,
  type ControlPlaneDatabase,
  type IntegrationWebhookEventStatus,
  type ScheduledActionStatus,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { TriggersBadRequestCodes } from "../constants.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const ListTriggerActivityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  })
  .strict();

export type ListTriggerActivityInput = z.infer<typeof ListTriggerActivityQuerySchema> & {
  organizationId: string;
  triggerId: string;
};

export type WebhookTriggerActivityItem = {
  id: string;
  sourceOccurredAt: string | null;
  finalizedAt: string | null;
  eventType: string;
  providerEventType: string;
  externalDeliveryId: string | null;
  status: IntegrationWebhookEventStatus;
};

export type ScheduledTriggerActivityItem = {
  id: string;
  scheduledAt: string;
  localScheduledDate: string;
  localScheduledTime: string;
  status: ScheduledActionStatus;
};

export type TriggerActivityResult =
  | {
      kind: "webhook";
      items: WebhookTriggerActivityItem[];
    }
  | {
      kind: "schedule";
      items: ScheduledTriggerActivityItem[];
    };

type TriggerActivitySubject =
  | {
      kind: "webhook";
      integrationWebhookSourceId: string;
    }
  | {
      kind: "schedule";
      scheduleId: string;
    };

async function loadTriggerActivitySubject(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  triggerId: string;
}): Promise<TriggerActivitySubject> {
  const tables = getControlPlaneDatabaseSchema(input.db);
  const [trigger] = await input.db
    .select({
      kind: tables.triggers.kind,
      integrationWebhookSourceId: tables.webhookTriggers.integrationWebhookSourceId,
      scheduleId: tables.scheduleTriggers.scheduleId,
    })
    .from(tables.triggers)
    .leftJoin(tables.webhookTriggers, eq(tables.webhookTriggers.triggerId, tables.triggers.id))
    .leftJoin(tables.scheduleTriggers, eq(tables.scheduleTriggers.triggerId, tables.triggers.id))
    .where(
      and(
        eq(tables.triggers.organizationId, input.organizationId),
        eq(tables.triggers.id, input.triggerId),
      ),
    )
    .limit(1);

  if (trigger === undefined) {
    throw new NotFoundError("NOT_FOUND", "Trigger was not found.");
  }

  if (trigger.kind === TriggerKinds.WEBHOOK) {
    if (trigger.integrationWebhookSourceId === null) {
      throw new Error(`Webhook trigger '${input.triggerId}' is missing a webhook source.`);
    }

    return {
      kind: "webhook",
      integrationWebhookSourceId: trigger.integrationWebhookSourceId,
    };
  }

  if (trigger.kind === TriggerKinds.SCHEDULE) {
    if (trigger.scheduleId === null) {
      throw new Error(`Scheduled trigger '${input.triggerId}' is missing a schedule.`);
    }

    return {
      kind: "schedule",
      scheduleId: trigger.scheduleId,
    };
  }

  throw new Error("Unsupported trigger kind.");
}

async function listWebhookActivity(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  integrationWebhookSourceId: string;
  limit: number;
}): Promise<WebhookTriggerActivityItem[]> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return await input.db
    .select({
      id: tables.integrationWebhookEvents.id,
      sourceOccurredAt: tables.integrationWebhookEvents.sourceOccurredAt,
      finalizedAt: tables.integrationWebhookEvents.finalizedAt,
      eventType: tables.integrationWebhookEvents.eventType,
      providerEventType: tables.integrationWebhookEvents.providerEventType,
      externalDeliveryId: tables.integrationWebhookEvents.externalDeliveryId,
      status: tables.integrationWebhookEvents.status,
    })
    .from(tables.integrationWebhookEvents)
    .where(
      and(
        eq(tables.integrationWebhookEvents.organizationId, input.organizationId),
        eq(
          tables.integrationWebhookEvents.integrationWebhookSourceId,
          input.integrationWebhookSourceId,
        ),
      ),
    )
    .orderBy(
      sql`${tables.integrationWebhookEvents.sourceOccurredAt} desc nulls last`,
      sql`${tables.integrationWebhookEvents.finalizedAt} desc nulls last`,
      desc(tables.integrationWebhookEvents.id),
    )
    .limit(input.limit);
}

async function listScheduledActivity(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  scheduleId: string;
  limit: number;
}): Promise<ScheduledTriggerActivityItem[]> {
  const tables = getControlPlaneDatabaseSchema(input.db);

  return await input.db
    .select({
      id: tables.scheduledActions.id,
      scheduledAt: tables.scheduledActions.scheduledAt,
      localScheduledDate: tables.scheduledActions.localScheduledDate,
      localScheduledTime: tables.scheduledActions.localScheduledTime,
      status: tables.scheduledActions.status,
    })
    .from(tables.scheduledActions)
    .where(
      and(
        eq(tables.scheduledActions.organizationId, input.organizationId),
        eq(tables.scheduledActions.scheduleId, input.scheduleId),
      ),
    )
    .orderBy(desc(tables.scheduledActions.scheduledAt), desc(tables.scheduledActions.id))
    .limit(input.limit);
}

export async function listTriggerActivity(
  ctx: { db: ControlPlaneDatabase },
  input: ListTriggerActivityInput,
): Promise<TriggerActivityResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const parsedLimit = ListTriggerActivityQuerySchema.shape.limit.safeParse(limit);
  if (!parsedLimit.success) {
    throw new BadRequestError(
      TriggersBadRequestCodes.INVALID_LIST_TRIGGER_ACTIVITY_INPUT,
      `\`limit\` must be an integer between 1 and ${String(MAX_LIMIT)}.`,
    );
  }

  const subject = await loadTriggerActivitySubject({
    db: ctx.db,
    organizationId: input.organizationId,
    triggerId: input.triggerId,
  });

  if (subject.kind === "webhook") {
    return {
      kind: "webhook",
      items: await listWebhookActivity({
        db: ctx.db,
        organizationId: input.organizationId,
        integrationWebhookSourceId: subject.integrationWebhookSourceId,
        limit,
      }),
    };
  }

  return {
    kind: "schedule",
    items: await listScheduledActivity({
      db: ctx.db,
      organizationId: input.organizationId,
      scheduleId: subject.scheduleId,
      limit,
    }),
  };
}
