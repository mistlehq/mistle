/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationWebhookEventStatuses,
  ScheduledActionStatuses,
  ScheduleKinds,
  ScheduleTargetTypes,
  TriggerKinds,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListTriggerActivityResponseSchema } from "../src/triggers/list-trigger-activity/schema.js";
import {
  seedPersistedWebhookTrigger,
  seedTriggerWebhookTargets,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("trigger activity integration", () => {
  it("lists recent webhook events for a webhook trigger source", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "trigger-activity-webhook@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_activity_webhook",
      webhookSourceId: "iws_trigger_activity_webhook",
      profileId: "sbp_trigger_activity_webhook",
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_activity_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_activity_webhook",
      profileId: "sbp_trigger_activity_webhook",
      profileVersion: 1,
      targetId: "atg_trigger_activity_webhook",
      name: "Activity webhook",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationWebhookEvents).values([
      {
        id: "iwe_trigger_activity_old",
        organizationId: session.organizationId,
        integrationConnectionId: "icn_trigger_activity_webhook",
        integrationWebhookSourceId: "iws_trigger_activity_webhook",
        targetKey: "github-cloud-trigger-webhooks",
        externalEventId: "delivery-old",
        externalDeliveryId: "delivery-old",
        eventType: "github.issue_comment.created",
        providerEventType: "issue_comment",
        payload: { action: "created" },
        sourceOccurredAt: "2026-03-10T00:00:00.000Z",
        finalizedAt: "2026-03-10T00:00:01.000Z",
        status: IntegrationWebhookEventStatuses.PROCESSED,
      },
      {
        id: "iwe_trigger_activity_new",
        organizationId: session.organizationId,
        integrationConnectionId: "icn_trigger_activity_webhook",
        integrationWebhookSourceId: "iws_trigger_activity_webhook",
        targetKey: "github-cloud-trigger-webhooks",
        externalEventId: "delivery-new",
        externalDeliveryId: "delivery-new",
        eventType: "github.pull_request.opened",
        providerEventType: "pull_request",
        payload: { action: "opened" },
        sourceOccurredAt: "2026-03-11T00:00:00.000Z",
        finalizedAt: null,
        status: IntegrationWebhookEventStatuses.RECEIVED,
      },
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/atm_trigger_activity_webhook/activity",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(ListTriggerActivityResponseSchema.parse(await response.json())).toEqual({
      kind: "webhook",
      items: [
        {
          id: "iwe_trigger_activity_new",
          sourceOccurredAt: "2026-03-11 00:00:00+00",
          finalizedAt: null,
          eventType: "github.pull_request.opened",
          providerEventType: "pull_request",
          externalDeliveryId: "delivery-new",
          status: "received",
        },
        {
          id: "iwe_trigger_activity_old",
          sourceOccurredAt: "2026-03-10 00:00:00+00",
          finalizedAt: "2026-03-10 00:00:01+00",
          eventType: "github.issue_comment.created",
          providerEventType: "issue_comment",
          externalDeliveryId: "delivery-old",
          status: "processed",
        },
      ],
    });
  });

  it("lists recent scheduled actions for a scheduled trigger", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "trigger-activity-schedule@example.com",
    });
    await seedScheduledTrigger(env, {
      organizationId: session.organizationId,
      triggerId: "atm_trigger_activity_schedule",
      scheduleId: "sch_trigger_activity_schedule",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.scheduledActions).values([
      {
        id: "sca_trigger_activity_old",
        scheduleId: "sch_trigger_activity_schedule",
        organizationId: session.organizationId,
        targetType: ScheduleTargetTypes.TRIGGER_RUN,
        targetPayload: { triggerId: "atm_trigger_activity_schedule" },
        scheduledAt: "2026-03-10T01:00:00.000Z",
        localScheduledDate: "2026-03-10",
        localScheduledTime: "09:00",
        status: ScheduledActionStatuses.DISPATCHED,
      },
      {
        id: "sca_trigger_activity_new",
        scheduleId: "sch_trigger_activity_schedule",
        organizationId: session.organizationId,
        targetType: ScheduleTargetTypes.TRIGGER_RUN,
        targetPayload: { triggerId: "atm_trigger_activity_schedule" },
        scheduledAt: "2026-03-11T01:00:00.000Z",
        localScheduledDate: "2026-03-11",
        localScheduledTime: "09:00",
        status: ScheduledActionStatuses.PENDING,
      },
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/atm_trigger_activity_schedule/activity",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(ListTriggerActivityResponseSchema.parse(await response.json())).toEqual({
      kind: "schedule",
      items: [
        {
          id: "sca_trigger_activity_new",
          scheduledAt: "2026-03-11 01:00:00+00",
          localScheduledDate: "2026-03-11",
          localScheduledTime: "09:00",
          status: "pending",
        },
        {
          id: "sca_trigger_activity_old",
          scheduledAt: "2026-03-10 01:00:00+00",
          localScheduledDate: "2026-03-10",
          localScheduledTime: "09:00",
          status: "dispatched",
        },
      ],
    });
  });

  it("does not expose trigger activity across organizations", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "trigger-activity-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "trigger-activity-org-b@example.com",
    });
    await seedScheduledTrigger(env, {
      organizationId: firstOrgSession.organizationId,
      triggerId: "atm_trigger_activity_private_schedule",
      scheduleId: "sch_trigger_activity_private_schedule",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/atm_trigger_activity_private_schedule/activity",
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
  });
});

async function seedScheduledTrigger(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    triggerId: string;
    scheduleId: string;
  },
): Promise<void> {
  const createdAt = "2026-03-01T00:00:00.000Z";
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: `${input.triggerId} schedule`,
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    kind: ScheduleKinds.RECURRING,
    name: `${input.triggerId} trigger`,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    nextScheduledAt: "2026-03-12T01:00:00.000Z",
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate: "Run schedule",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    createdAt,
    updatedAt: createdAt,
  });
}
