/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { AutomationKinds, ScheduleTargetTypes } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { GetAutomationResponseSchema } from "../src/automations/get-automation/schema.js";
import { ListAutomationsResponseSchema } from "../src/automations/list-automations/schema.js";
import {
  seedAutomationWebhookTargets,
  seedPersistedWebhookAutomation,
  seedWebhookAutomationFixture,
} from "./helpers/automation-webhooks.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("automations list integration", () => {
  it("filters mixed automations by sandbox profile within the active organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "automations-list-profile-filter-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "automations-list-profile-filter-org-b@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_automations_list_filter_profile_a",
      webhookSourceId: "iws_automations_list_filter_profile_a",
      profileId: "sbp_automations_list_filter_a",
      profileVersion: 1,
    });
    await seedWebhookAutomationFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_automations_list_filter_profile_b",
      webhookSourceId: "iws_automations_list_filter_profile_b",
      profileId: "sbp_automations_list_filter_b",
      profileVersion: 1,
    });
    await seedWebhookAutomationFixture(env, {
      organizationId: secondOrgSession.organizationId,
      connectionId: "icn_automations_list_filter_other_org",
      webhookSourceId: "iws_automations_list_filter_other_org",
      profileId: "sbp_automations_list_filter_other_org",
      profileVersion: 1,
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automations_list_filter_webhook_a",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_automations_list_filter_profile_a",
      profileId: "sbp_automations_list_filter_a",
      profileVersion: 1,
      targetId: "atg_automations_list_filter_webhook_a",
      name: "Profile A webhook",
      createdAt: "2026-03-03T00:00:00.000Z",
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automations_list_filter_webhook_b",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_automations_list_filter_profile_b",
      profileId: "sbp_automations_list_filter_b",
      profileVersion: 1,
      targetId: "atg_automations_list_filter_webhook_b",
      name: "Profile B webhook",
      createdAt: "2026-03-02T00:00:00.000Z",
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automations_list_filter_other_org",
      organizationId: secondOrgSession.organizationId,
      webhookSourceId: "iws_automations_list_filter_other_org",
      profileId: "sbp_automations_list_filter_other_org",
      profileVersion: 1,
      targetId: "atg_automations_list_filter_other_org",
      name: "Other org webhook",
      createdAt: "2026-03-04T00:00:00.000Z",
    });
    await seedScheduledAutomation(env, {
      organizationId: firstOrgSession.organizationId,
      automationId: "atm_automations_list_filter_schedule_a",
      scheduleId: "sch_automations_list_filter_schedule_a",
      targetId: "atg_automations_list_filter_schedule_a",
      profileId: "sbp_automations_list_filter_a",
      name: "Profile A schedule",
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/automations?sandboxProfileId=sbp_automations_list_filter_a&limit=10",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = ListAutomationsResponseSchema.parse(await response.json());
    expect(body.totalResults).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual([
      "atm_automations_list_filter_webhook_a",
      "atm_automations_list_filter_schedule_a",
    ]);
    expect(body.items.map((item) => item.target.sandboxProfileId)).toEqual([
      "sbp_automations_list_filter_a",
      "sbp_automations_list_filter_a",
    ]);
  });

  it("gets a mixed automation summary by id within the active organization", async ({ env }) => {
    const scheduleAutomationId = "atm_automations_get_summary_schedule";
    const webhookAutomationId = "atm_automations_get_summary_webhook";
    const firstOrgSession = await env.auth.createSession({
      email: "automations-get-summary-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "automations-get-summary-org-b@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_automations_get_summary_webhook",
      webhookSourceId: "iws_automations_get_summary_webhook",
      profileId: "sbp_automations_get_summary_webhook",
      profileVersion: 1,
    });
    await seedPersistedWebhookAutomation(env, {
      organizationId: firstOrgSession.organizationId,
      automationId: webhookAutomationId,
      webhookSourceId: "iws_automations_get_summary_webhook",
      profileId: "sbp_automations_get_summary_webhook",
      profileVersion: 1,
      targetId: "atg_automations_get_summary_webhook",
      name: "Webhook summary",
      createdAt: "2026-03-06T00:00:00.000Z",
    });
    await seedScheduledAutomation(env, {
      organizationId: firstOrgSession.organizationId,
      automationId: scheduleAutomationId,
      scheduleId: "sch_automations_get_summary_schedule",
      targetId: "atg_automations_get_summary_schedule",
      profileId: "sbp_automations_get_summary_schedule",
      name: "Daily summary",
      createdAt: "2026-03-05T00:00:00.000Z",
    });

    const listResponse = await env.controlPlaneApi.http.fetch("/v1/automations?limit=10", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });

    expect(listResponse.status).toBe(200);
    const listBody = ListAutomationsResponseSchema.parse(await listResponse.json());
    for (const automationId of [webhookAutomationId, scheduleAutomationId]) {
      const listedAutomation = listBody.items.find((item) => item.id === automationId);
      if (listedAutomation === undefined) {
        throw new Error(`Expected seeded automation '${automationId}' in list response.`);
      }

      const response = await env.controlPlaneApi.http.fetch(`/v1/automations/${automationId}`, {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      });

      expect(response.status).toBe(200);
      const body = GetAutomationResponseSchema.parse(await response.json());
      expect(body).toEqual(listedAutomation);
    }

    const otherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/automations/${scheduleAutomationId}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );

    expect(otherOrgResponse.status).toBe(404);
  });
});

async function seedScheduledAutomation(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    automationId: string;
    scheduleId: string;
    targetId: string;
    profileId: string;
    name: string;
    createdAt: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfiles)
    .values(
      sandboxProfileRow({
        id: input.profileId,
        organizationId: input.organizationId,
        displayName: `${input.profileId} display`,
        activeVersion: 1,
        createdAt: input.createdAt,
      }),
    )
    .onConflictDoNothing();
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersions)
    .values(
      sandboxProfileVersionRow({
        sandboxProfileId: input.profileId,
        version: 1,
      }),
    )
    .onConflictDoNothing();
  await env.controlPlaneDb.insert(env.controlPlaneTables.automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.SCHEDULE,
    name: input.name,
    enabled: true,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    name: `${input.name} trigger`,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-03-04T01:00:00.000Z",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleAutomations).values({
    scheduleId: input.scheduleId,
    automationId: input.automationId,
    inputTemplate: "Run schedule",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.automationTargets).values({
    id: input.targetId,
    automationId: input.automationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
