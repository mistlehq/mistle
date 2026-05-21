/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  ScheduleKinds,
  ScheduleTargetTypes,
  TriggerKinds,
  type ScheduleKind,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { GetTriggerResponseSchema } from "../src/triggers/get-trigger/schema.js";
import { ListTriggersResponseSchema } from "../src/triggers/list-triggers/schema.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";
import {
  seedTriggerWebhookTargets,
  seedPersistedWebhookTrigger,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("triggers list integration", () => {
  it("filters mixed triggers by sandbox profile and returns referenced versions within the active organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "triggers-list-profile-filter-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "triggers-list-profile-filter-org-b@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_triggers_list_filter_profile_a",
      webhookSourceId: "iws_triggers_list_filter_profile_a",
      profileId: "sbp_triggers_list_filter_a",
      profileVersion: 2,
    });
    await seedWebhookTriggerFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_triggers_list_filter_profile_b",
      webhookSourceId: "iws_triggers_list_filter_profile_b",
      profileId: "sbp_triggers_list_filter_b",
      profileVersion: 1,
    });
    await seedWebhookTriggerFixture(env, {
      organizationId: secondOrgSession.organizationId,
      connectionId: "icn_triggers_list_filter_other_org",
      webhookSourceId: "iws_triggers_list_filter_other_org",
      profileId: "sbp_triggers_list_filter_other_org",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_triggers_list_filter_webhook_a",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_triggers_list_filter_profile_a",
      profileId: "sbp_triggers_list_filter_a",
      profileVersion: 2,
      targetId: "atg_triggers_list_filter_webhook_a",
      name: "Profile A webhook",
      createdAt: "2026-03-03T00:00:00.000Z",
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_triggers_list_filter_webhook_b",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_triggers_list_filter_profile_b",
      profileId: "sbp_triggers_list_filter_b",
      profileVersion: 1,
      targetId: "atg_triggers_list_filter_webhook_b",
      name: "Profile B webhook",
      createdAt: "2026-03-02T00:00:00.000Z",
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_triggers_list_filter_other_org",
      organizationId: secondOrgSession.organizationId,
      webhookSourceId: "iws_triggers_list_filter_other_org",
      profileId: "sbp_triggers_list_filter_other_org",
      profileVersion: 1,
      targetId: "atg_triggers_list_filter_other_org",
      name: "Other org webhook",
      createdAt: "2026-03-04T00:00:00.000Z",
    });
    await seedScheduledTrigger(env, {
      organizationId: firstOrgSession.organizationId,
      triggerId: "atm_triggers_list_filter_schedule_a",
      scheduleId: "sch_triggers_list_filter_schedule_a",
      targetId: "atg_triggers_list_filter_schedule_a",
      profileId: "sbp_triggers_list_filter_a",
      profileVersion: 4,
      name: "Profile A schedule",
      createdAt: "2026-03-01T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers?sandboxProfileId=sbp_triggers_list_filter_a&limit=10",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = ListTriggersResponseSchema.parse(await response.json());
    expect(body.totalResults).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual([
      "atm_triggers_list_filter_webhook_a",
      "atm_triggers_list_filter_schedule_a",
    ]);
    expect(body.items.map((item) => item.target.sandboxProfileId)).toEqual([
      "sbp_triggers_list_filter_a",
      "sbp_triggers_list_filter_a",
    ]);
    expect(body.items.map((item) => item.target.sandboxProfileVersion)).toEqual([2, 4]);
  });

  it("only lists recurring scheduled trigger summaries", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "triggers-list-one-off-excluded@example.com",
    });

    await seedScheduledTrigger(env, {
      organizationId: session.organizationId,
      triggerId: "atm_triggers_list_one_off_excluded",
      scheduleId: "sch_triggers_list_one_off_excluded",
      targetId: "atg_triggers_list_one_off_excluded",
      profileId: "sbp_triggers_list_one_off_excluded",
      name: "One-off excluded schedule",
      createdAt: "2026-03-05T00:00:00.000Z",
      scheduleKind: ScheduleKinds.ONE_OFF,
    });

    const defaultResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers?kind=schedule&sandboxProfileId=sbp_triggers_list_one_off_excluded&limit=10",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(defaultResponse.status).toBe(200);
    const defaultBody = ListTriggersResponseSchema.parse(await defaultResponse.json());
    expect(defaultBody.totalResults).toBe(0);
    expect(defaultBody.items).toEqual([]);
  });

  it("applies trigger list filters before pagination and total results", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "triggers-list-query-filters@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_triggers_list_query_filters_webhook",
      webhookSourceId: "iws_triggers_list_query_filters_webhook",
      profileId: "sbp_triggers_list_query_filters_webhook",
      profileVersion: 1,
      bindingRepositories: ["mistlehq/server-search"],
    });
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_triggers_list_query_filters_disabled",
      webhookSourceId: "iws_triggers_list_query_filters_disabled",
      profileId: "sbp_triggers_list_query_filters_disabled",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_triggers_list_query_filters_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_triggers_list_query_filters_webhook",
      profileId: "sbp_triggers_list_query_filters_webhook",
      profileVersion: 1,
      targetId: "atg_triggers_list_query_filters_webhook",
      primaryRepositoryId: "mistlehq/server-search",
      name: "Webhook issue comment triage",
      createdAt: "2026-03-13T00:00:00.000Z",
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_triggers_list_query_filters_disabled",
      organizationId: session.organizationId,
      webhookSourceId: "iws_triggers_list_query_filters_disabled",
      profileId: "sbp_triggers_list_query_filters_disabled",
      profileVersion: 1,
      targetId: "atg_triggers_list_query_filters_disabled",
      name: "Disabled webhook triage",
      enabled: false,
      createdAt: "2026-03-12T00:00:00.000Z",
    });
    await seedScheduledTrigger(env, {
      organizationId: session.organizationId,
      triggerId: "atm_triggers_list_query_filters_schedule",
      scheduleId: "sch_triggers_list_query_filters_schedule",
      targetId: "atg_triggers_list_query_filters_schedule",
      profileId: "sbp_triggers_list_query_filters_schedule",
      name: "Daily Singapore schedule",
      createdAt: "2026-03-11T00:00:00.000Z",
      primaryRepositoryId: "mistlehq/scheduled-search",
    });

    const eventResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers?kind=webhook&limit=1",
      {
        headers: { cookie: session.cookie },
      },
    );
    const disabledResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers?enabled=false&limit=10",
      {
        headers: { cookie: session.cookie },
      },
    );
    const eventLabelSearchResponse = await env.controlPlaneApi.http.fetch(
      `/v1/triggers?search=${encodeURIComponent("Issue comment created")}&limit=10`,
      {
        headers: { cookie: session.cookie },
      },
    );
    const eventAliasSearchResponse = await env.controlPlaneApi.http.fetch(
      `/v1/triggers?search=${encodeURIComponent("events")}&limit=10`,
      {
        headers: { cookie: session.cookie },
      },
    );
    const scheduleSearchResponse = await env.controlPlaneApi.http.fetch(
      `/v1/triggers?kind=schedule&search=${encodeURIComponent("Asia/Singapore")}&limit=10`,
      {
        headers: { cookie: session.cookie },
      },
    );
    const repositorySearchResponse = await env.controlPlaneApi.http.fetch(
      `/v1/triggers?search=${encodeURIComponent("mistlehq/server-search")}&limit=10`,
      {
        headers: { cookie: session.cookie },
      },
    );

    expect(eventResponse.status).toBe(200);
    expect(disabledResponse.status).toBe(200);
    expect(eventLabelSearchResponse.status).toBe(200);
    expect(eventAliasSearchResponse.status).toBe(200);
    expect(scheduleSearchResponse.status).toBe(200);
    expect(repositorySearchResponse.status).toBe(200);

    const eventBody = ListTriggersResponseSchema.parse(await eventResponse.json());
    expect(eventBody.totalResults).toBe(2);
    expect(eventBody.items.map((item) => item.kind)).toEqual(["webhook"]);
    expect(eventBody.nextPage).not.toBeNull();

    const disabledBody = ListTriggersResponseSchema.parse(await disabledResponse.json());
    expect(disabledBody.totalResults).toBe(1);
    expect(disabledBody.items.map((item) => item.id)).toEqual([
      "atm_triggers_list_query_filters_disabled",
    ]);

    const eventLabelSearchBody = ListTriggersResponseSchema.parse(
      await eventLabelSearchResponse.json(),
    );
    expect(eventLabelSearchBody.items.map((item) => item.id)).toEqual([
      "atm_triggers_list_query_filters_webhook",
      "atm_triggers_list_query_filters_disabled",
    ]);

    const eventAliasSearchBody = ListTriggersResponseSchema.parse(
      await eventAliasSearchResponse.json(),
    );
    expect(eventAliasSearchBody.items.map((item) => item.id)).toEqual([
      "atm_triggers_list_query_filters_webhook",
      "atm_triggers_list_query_filters_disabled",
    ]);

    const scheduleSearchBody = ListTriggersResponseSchema.parse(
      await scheduleSearchResponse.json(),
    );
    expect(scheduleSearchBody.items.map((item) => item.id)).toEqual([
      "atm_triggers_list_query_filters_schedule",
    ]);

    const repositorySearchBody = ListTriggersResponseSchema.parse(
      await repositorySearchResponse.json(),
    );
    expect(repositorySearchBody.items.map((item) => item.id)).toEqual([
      "atm_triggers_list_query_filters_webhook",
    ]);
  });

  it("gets a mixed trigger summary by id within the active organization", async ({ env }) => {
    const scheduleTriggerId = "atm_triggers_get_summary_schedule";
    const webhookTriggerId = "atm_triggers_get_summary_webhook";
    const firstOrgSession = await env.auth.createSession({
      email: "triggers-get-summary-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "triggers-get-summary-org-b@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_triggers_get_summary_webhook",
      webhookSourceId: "iws_triggers_get_summary_webhook",
      profileId: "sbp_triggers_get_summary_webhook",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      organizationId: firstOrgSession.organizationId,
      triggerId: webhookTriggerId,
      webhookSourceId: "iws_triggers_get_summary_webhook",
      profileId: "sbp_triggers_get_summary_webhook",
      profileVersion: 1,
      targetId: "atg_triggers_get_summary_webhook",
      name: "Webhook summary",
      createdAt: "2026-03-06T00:00:00.000Z",
    });
    await seedScheduledTrigger(env, {
      organizationId: firstOrgSession.organizationId,
      triggerId: scheduleTriggerId,
      scheduleId: "sch_triggers_get_summary_schedule",
      targetId: "atg_triggers_get_summary_schedule",
      profileId: "sbp_triggers_get_summary_schedule",
      name: "Daily summary",
      createdAt: "2026-03-05T00:00:00.000Z",
    });

    const listResponse = await env.controlPlaneApi.http.fetch("/v1/triggers?limit=10", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });

    expect(listResponse.status).toBe(200);
    const listBody = ListTriggersResponseSchema.parse(await listResponse.json());
    for (const triggerId of [webhookTriggerId, scheduleTriggerId]) {
      const listedTrigger = listBody.items.find((item) => item.id === triggerId);
      if (listedTrigger === undefined) {
        throw new Error(`Expected seeded trigger '${triggerId}' in list response.`);
      }

      const response = await env.controlPlaneApi.http.fetch(`/v1/triggers/${triggerId}`, {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      });

      expect(response.status).toBe(200);
      const body = GetTriggerResponseSchema.parse(await response.json());
      expect(body).toEqual(listedTrigger);
    }

    const otherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/triggers/${scheduleTriggerId}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );

    expect(otherOrgResponse.status).toBe(404);
  });
});

async function seedScheduledTrigger(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    triggerId: string;
    scheduleId: string;
    targetId: string;
    profileId: string;
    profileVersion?: number;
    name: string;
    createdAt: string;
    primaryRepositoryId?: string | null;
    scheduleKind?: ScheduleKind;
  },
): Promise<void> {
  const profileVersion = input.profileVersion ?? 1;
  const scheduleKind = input.scheduleKind ?? ScheduleKinds.RECURRING;

  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfiles)
    .values(
      sandboxProfileRow({
        id: input.profileId,
        organizationId: input.organizationId,
        displayName: `${input.profileId} display`,
        activeVersion: profileVersion,
        createdAt: input.createdAt,
      }),
    )
    .onConflictDoNothing();
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.sandboxProfileVersions)
    .values(
      sandboxProfileVersionRow({
        sandboxProfileId: input.profileId,
        version: profileVersion,
      }),
    )
    .onConflictDoNothing();
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: input.name,
    enabled: true,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: input.scheduleId,
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    kind: scheduleKind,
    name: `${input.name} trigger`,
    ...(scheduleKind === ScheduleKinds.RECURRING
      ? {
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
          nextScheduledAt: "2026-03-04T01:00:00.000Z",
        }
      : {
          cronExpression: null,
          timezone: null,
          startAt: "2099-03-04T01:00:00.000Z",
          nextScheduledAt: "2099-03-04T01:00:00.000Z",
        }),
    enabled: true,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: input.scheduleId,
    triggerId: input.triggerId,
    inputTemplate: "Run schedule",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerTargets).values({
    id: input.targetId,
    triggerId: input.triggerId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: profileVersion,
    primaryRepositoryId: input.primaryRepositoryId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}
