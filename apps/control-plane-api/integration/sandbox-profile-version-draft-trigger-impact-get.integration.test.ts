/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerKinds,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionStates,
  ScheduleTargetTypes,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { GetSandboxProfileVersionDraftTriggerImpactResponseSchema } from "../src/sandbox-profiles/index.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";
import {
  seedTriggerWebhookTargets,
  seedPersistedWebhookTrigger,
  seedWebhookTriggerFixture,
  OpenAiTriggerTargetKey,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const TestCreatedAt = "2026-05-08T00:00:00.000Z";

describe.concurrent("sandbox profile version draft trigger impact get integration", () => {
  it("reports triggers that would break against the saved draft version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-draft-trigger-impact@example.com",
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
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
        targetKey: OpenAiTriggerTargetKey,
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
          config: {},
        }),
      );
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_draft_impact_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_webhook",
      profileId: "sbp_draft_impact_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_webhook",
      name: "Webhook triage",
      primaryRepositoryId: "github:missing/repository",
    });
    await seedScheduledTrigger(env, {
      triggerId: "atm_draft_impact_schedule",
      organizationId: session.organizationId,
      profileId: "sbp_draft_impact_001",
      profileVersion: 1,
      primaryRepositoryId: "github:missing/scheduled-repository",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_001/versions/2/draft-trigger-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: true,
      affectedTriggers: [
        {
          id: "atm_draft_impact_schedule",
          name: "Scheduled check",
          kind: "schedule",
          enabled: true,
          issues: [
            {
              code: "PRIMARY_REPOSITORY_UNAVAILABLE",
              message:
                "Trigger 'Scheduled check' uses primary repository 'github:missing/scheduled-repository', but that repository is not available in the draft.",
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
                "Webhook trigger 'Webhook triage' uses connection 'icn_draft_impact_webhook', but the draft does not bind that connection.",
              connectionId: "icn_draft_impact_webhook",
            },
            {
              code: "PRIMARY_REPOSITORY_UNAVAILABLE",
              message:
                "Trigger 'Webhook triage' uses primary repository 'github:missing/repository', but that repository is not available in the draft.",
              primaryRepositoryId: "github:missing/repository",
            },
          ],
        },
      ],
    });
  });

  it("returns no breaking changes when multiple agent provider bindings are valid", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-draft-trigger-impact-ok@example.com",
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
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
        agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      integrationTargetRow({
        targetKey: "anthropic-default-draft-impact-ok",
        familyId: "anthropic",
        variantId: "anthropic-default",
        enabled: true,
        config: {},
      }),
      integrationTargetRow({
        targetKey: "opencode-go-draft-impact-ok",
        familyId: "opencode",
        variantId: "opencode-go",
        enabled: true,
        config: {},
      }),
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_draft_impact_ok_agent",
        organizationId: session.organizationId,
        targetKey: OpenAiTriggerTargetKey,
        displayName: "Draft impact ok agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_draft_impact_ok_anthropic_agent",
        organizationId: session.organizationId,
        targetKey: "anthropic-default-draft-impact-ok",
        displayName: "Draft impact ok Anthropic agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_draft_impact_ok_opencode_agent",
        organizationId: session.organizationId,
        targetKey: "opencode-go-draft-impact-ok",
        displayName: "Draft impact ok OpenCode agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_ok_agent",
          sandboxProfileId: "sbp_draft_impact_ok_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_ok_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_ok_anthropic_agent",
          sandboxProfileId: "sbp_draft_impact_ok_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_ok_anthropic_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_ok_opencode_agent",
          sandboxProfileId: "sbp_draft_impact_ok_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_ok_opencode_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_ok_webhook",
          sandboxProfileId: "sbp_draft_impact_ok_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_ok_webhook",
          kind: IntegrationBindingKinds.CONNECTOR,
        }),
      ]);
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_draft_impact_ok_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_ok_webhook",
      profileId: "sbp_draft_impact_ok_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_ok_webhook",
      name: "Webhook triage ok",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_ok_001/versions/2/draft-trigger-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: false,
      affectedTriggers: [],
    });
  });

  it("reports duplicate agent provider bindings as breaking trigger impact", async ({ env }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-draft-trigger-impact-duplicate-agent@example.com",
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_draft_impact_duplicate_webhook",
      webhookSourceId: "iws_draft_impact_duplicate_webhook",
      profileId: "sbp_draft_impact_duplicate_001",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_impact_duplicate_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_draft_impact_duplicate_agent_primary",
        organizationId: session.organizationId,
        targetKey: OpenAiTriggerTargetKey,
        displayName: "Draft impact duplicate agent primary",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_draft_impact_duplicate_agent_secondary",
        organizationId: session.organizationId,
        targetKey: OpenAiTriggerTargetKey,
        displayName: "Draft impact duplicate agent secondary",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_duplicate_agent_primary",
          sandboxProfileId: "sbp_draft_impact_duplicate_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_duplicate_agent_primary",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_duplicate_agent_secondary",
          sandboxProfileId: "sbp_draft_impact_duplicate_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_duplicate_agent_secondary",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_duplicate_webhook",
          sandboxProfileId: "sbp_draft_impact_duplicate_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_duplicate_webhook",
          kind: IntegrationBindingKinds.CONNECTOR,
        }),
      ]);
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_draft_impact_duplicate_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_duplicate_webhook",
      profileId: "sbp_draft_impact_duplicate_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_duplicate_webhook",
      name: "Webhook triage duplicate agent",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_duplicate_001/versions/2/draft-trigger-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: true,
      affectedTriggers: [
        {
          id: "atm_draft_impact_duplicate_webhook",
          name: "Webhook triage duplicate agent",
          kind: "webhook",
          enabled: true,
          issues: [
            {
              code: "AGENT_BINDING_AMBIGUOUS",
              message:
                "Agent binding 'ibd_draft_impact_duplicate_agent_secondary' duplicates provider 'openai' already bound by 'ibd_draft_impact_duplicate_agent_primary'.",
              bindingId: "ibd_draft_impact_duplicate_agent_secondary",
              connectionId: "icn_draft_impact_duplicate_agent_secondary",
              targetKey: OpenAiTriggerTargetKey,
            },
          ],
        },
      ],
    });
  });

  it("reports agent provider bindings that are incompatible with the draft runtime", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-draft-trigger-impact-runtime-agent@example.com",
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_draft_impact_runtime_webhook",
      webhookSourceId: "iws_draft_impact_runtime_webhook",
      profileId: "sbp_draft_impact_runtime_001",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_impact_runtime_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "anthropic-default-draft-impact-runtime",
        familyId: "anthropic",
        variantId: "anthropic-default",
        enabled: true,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_draft_impact_runtime_openai_agent",
        organizationId: session.organizationId,
        targetKey: OpenAiTriggerTargetKey,
        displayName: "Draft impact runtime OpenAI agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_draft_impact_runtime_anthropic_agent",
        organizationId: session.organizationId,
        targetKey: "anthropic-default-draft-impact-runtime",
        displayName: "Draft impact runtime Anthropic agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_runtime_openai_agent",
          sandboxProfileId: "sbp_draft_impact_runtime_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_runtime_openai_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_runtime_anthropic_agent",
          sandboxProfileId: "sbp_draft_impact_runtime_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_runtime_anthropic_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_runtime_webhook",
          sandboxProfileId: "sbp_draft_impact_runtime_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_runtime_webhook",
          kind: IntegrationBindingKinds.CONNECTOR,
        }),
      ]);
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_draft_impact_runtime_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_runtime_webhook",
      profileId: "sbp_draft_impact_runtime_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_runtime_webhook",
      name: "Webhook triage runtime mismatch",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_runtime_001/versions/2/draft-trigger-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: true,
      affectedTriggers: [
        {
          id: "atm_draft_impact_runtime_webhook",
          name: "Webhook triage runtime mismatch",
          kind: "webhook",
          enabled: true,
          issues: [
            {
              code: "AGENT_BINDING_RUNTIME_INCOMPATIBLE",
              message:
                "Agent binding 'ibd_draft_impact_runtime_anthropic_agent' references provider 'anthropic' that is not compatible with runtime 'codex'.",
              bindingId: "ibd_draft_impact_runtime_anthropic_agent",
              connectionId: "icn_draft_impact_runtime_anthropic_agent",
              targetKey: "anthropic-default-draft-impact-runtime",
            },
          ],
        },
      ],
    });
  });

  it("reports OpenCode drafts that are missing the primary OpenCode agent provider", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-draft-trigger-impact-primary-agent@example.com",
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_draft_impact_primary_webhook",
      webhookSourceId: "iws_draft_impact_primary_webhook",
      profileId: "sbp_draft_impact_primary_001",
      profileVersion: 1,
      profileActiveVersion: 1,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_draft_impact_primary_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "anthropic-default-draft-impact-primary",
        familyId: "anthropic",
        variantId: "anthropic-default",
        enabled: true,
        config: {},
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_draft_impact_primary_openai_agent",
        organizationId: session.organizationId,
        targetKey: OpenAiTriggerTargetKey,
        displayName: "Draft impact primary OpenAI agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_draft_impact_primary_anthropic_agent",
        organizationId: session.organizationId,
        targetKey: "anthropic-default-draft-impact-primary",
        displayName: "Draft impact primary Anthropic agent",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_primary_openai_agent",
          sandboxProfileId: "sbp_draft_impact_primary_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_primary_openai_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_primary_anthropic_agent",
          sandboxProfileId: "sbp_draft_impact_primary_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_primary_anthropic_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_draft_impact_primary_webhook",
          sandboxProfileId: "sbp_draft_impact_primary_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_draft_impact_primary_webhook",
          kind: IntegrationBindingKinds.CONNECTOR,
        }),
      ]);
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_draft_impact_primary_webhook",
      organizationId: session.organizationId,
      webhookSourceId: "iws_draft_impact_primary_webhook",
      profileId: "sbp_draft_impact_primary_001",
      profileVersion: 1,
      targetId: "atg_draft_impact_primary_webhook",
      name: "Webhook triage missing primary agent",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_draft_impact_primary_001/versions/2/draft-trigger-impact",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionDraftTriggerImpactResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      hasBreakingChanges: true,
      affectedTriggers: [
        {
          id: "atm_draft_impact_primary_webhook",
          name: "Webhook triage missing primary agent",
          kind: "webhook",
          enabled: true,
          issues: [
            {
              code: "AGENT_BINDING_PRIMARY_REQUIRED",
              message:
                "Sandbox profile version '2' must have an agent binding for provider 'opencode' to run triggers with runtime 'opencode'.",
            },
          ],
        },
      ],
    });
  });
});

async function seedScheduledTrigger(
  env: IntegrationTestEnvironment,
  input: {
    triggerId: string;
    organizationId: string;
    profileId: string;
    profileVersion: number;
    primaryRepositoryId: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: TriggerKinds.SCHEDULE,
    name: "Scheduled check",
    enabled: true,
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.schedules).values({
    id: "sch_draft_impact_schedule",
    organizationId: input.organizationId,
    targetType: ScheduleTargetTypes.TRIGGER_RUN,
    name: "Scheduled check",
    cronExpression: "0 * * * *",
    timezone: "UTC",
    enabled: true,
    nextScheduledAt: "2026-05-08T01:00:00.000Z",
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.scheduleTriggers).values({
    scheduleId: "sch_draft_impact_schedule",
    triggerId: input.triggerId,
    inputTemplate: "Run scheduled check",
    conversationKeyTemplate: "{{schedule.id}}",
    idempotencyKeyTemplate: "{{scheduled_action.id}}",
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerTargets).values({
    id: "atg_draft_impact_schedule",
    triggerId: input.triggerId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: input.profileVersion,
    primaryRepositoryId: input.primaryRepositoryId,
    createdAt: TestCreatedAt,
    updatedAt: TestCreatedAt,
  });
}
