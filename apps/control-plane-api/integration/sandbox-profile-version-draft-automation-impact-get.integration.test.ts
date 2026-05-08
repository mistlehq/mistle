/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationKinds,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { GetSandboxProfileVersionDraftAutomationImpactResponseSchema } from "../src/sandbox-profiles/index.js";
import {
  seedAutomationWebhookTargets,
  seedPersistedWebhookAutomation,
  seedWebhookAutomationFixture,
  OpenAiAutomationTargetKey,
} from "./helpers/automation-webhooks.js";
import {
  integrationConnectionRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const TestCreatedAt = "2026-05-08T00:00:00.000Z";

describe.concurrent("sandbox profile version draft automation impact get integration", () => {
  it("reports automations that would break against the saved draft version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-draft-automation-impact@example.com",
    });

    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_draft_impact_webhook",
      webhookSourceId: "iws_draft_impact_webhook",
      profileId: "sbp_draft_impact_001",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_impact_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_draft_impact_agent",
        organizationId: session.organizationId,
        targetKey: OpenAiAutomationTargetKey,
        displayName: "Draft impact agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_agent",
          sandboxProfileId: "sbp_draft_impact_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {
            runtime: {
              runtimeId: "codex",
            },
          },
        }),
      );
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_draft_impact_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_webhook",
      profileId: "sbp_draft_impact_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_webhook",
      name: "Webhook triage",
      primaryRepositoryId: "github:missing/repository",
    });
    await seedScheduledAutomation(env, {
      automationId: "atm_draft_impact_schedule",
      organizationId: session.organizationId,
      profileId: "sbp_draft_impact_001",
      profileVersion: 1,
      primaryRepositoryId: "github:missing/scheduled-repository",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_001/versions/2/draft-automation-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftAutomationImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: true,
      affectedAutomations: [
        {
          id: "atm_draft_impact_schedule",
          name: "Scheduled check",
          kind: "schedule",
          enabled: true,
          issues: [
            {
              code: "PRIMARY_REPOSITORY_UNAVAILABLE",
              message:
                "Automation 'Scheduled check' uses primary repository 'github:missing/scheduled-repository', but that repository is not available in the draft.",
              primaryRepositoryId: "github:missing/scheduled-repository",
            },
          ],
        },
        {
          id: "atm_draft_impact_webhook",
          name: "Webhook triage",
          kind: "webhook",
          enabled: true,
          issues: [
            {
              code: "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
              message:
                "Webhook automation 'Webhook triage' uses connection 'icn_draft_impact_webhook', but the draft does not bind that connection.",
              connectionId: "icn_draft_impact_webhook",
            },
            {
              code: "PRIMARY_REPOSITORY_UNAVAILABLE",
              message:
                "Automation 'Webhook triage' uses primary repository 'github:missing/repository', but that repository is not available in the draft.",
              primaryRepositoryId: "github:missing/repository",
            },
          ],
        },
      ],
    });
  });

  it("returns no breaking changes when the draft keeps automation dependencies available", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-draft-automation-impact-ok@example.com",
    });

    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_draft_impact_ok_webhook",
      webhookSourceId: "iws_draft_impact_ok_webhook",
      profileId: "sbp_draft_impact_ok_001",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_impact_ok_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_draft_impact_ok_agent",
        organizationId: session.organizationId,
        targetKey: OpenAiAutomationTargetKey,
        displayName: "Draft impact ok agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_ok_agent",
          sandboxProfileId: "sbp_draft_impact_ok_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_ok_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {
            runtime: {
              runtimeId: "codex",
            },
          },
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_ok_webhook",
          sandboxProfileId: "sbp_draft_impact_ok_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_ok_webhook",
          kind: IntegrationBindingKinds.CONNECTOR,
        }),
      ]);
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_draft_impact_ok_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_ok_webhook",
      profileId: "sbp_draft_impact_ok_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_ok_webhook",
      name: "Webhook triage ok",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_ok_001/versions/2/draft-automation-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftAutomationImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: false,
      affectedAutomations: [],
    });
  });
});

async function seedScheduledAutomation(
  env: IntegrationTestEnvironment,
  input: {
    automationId: string;
    organizationId: string;
    profileId: string;
    profileVersion: number;
    primaryRepositoryId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.automations).values({
    id: input.automationId,
    organizationId: input.organizationId,
    kind: AutomationKinds.SCHEDULE,
    name: "Scheduled check",
    enabled: true,
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: "sch_draft_impact_schedule",
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.AUTOMATION_RUN,
    name: "Scheduled check",
    cronExpression: "0 * * * *",
    timezone: "UTC",
    enabled: true,
    nextScheduledAt: "2026-05-08T01:00:00.000Z",
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleAutomations).values({
    scheduleId: "sch_draft_impact_schedule",
    automationId: input.automationId,
    inputTemplate: "Run scheduled check",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{scheduled_action.id}}",
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.automationTargets).values({
    id: "atg_draft_impact_schedule",
    automationId: input.automationId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    primaryRepositoryId: input.primaryRepositoryId,
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
}
