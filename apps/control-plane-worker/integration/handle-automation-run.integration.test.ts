/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationConversationCreatedByKinds,
  AutomationConversationDeliveryProcessorStatuses,
  AutomationConversationDeliveryTaskStatuses,
  AutomationConversationOwnerKinds,
  AutomationConversationStatuses,
  AutomationKinds,
  AutomationRunStatuses,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
} from "@mistle/db/control-plane";
import { OpenAiApiKeyDefinition } from "@mistle/integrations-definitions";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { handoffAutomationRunDelivery } from "../openworkflow/handle-automation-run/handoff-automation-run-delivery.js";
import { transitionAutomationRunToRunning } from "../openworkflow/handle-automation-run/transition-automation-run-to-running.js";
import {
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
} from "../openworkflow/shared/automation-run.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

const OpenAiAgentTargetConfig = {
  api_base_url: "https://api.openai.com/v1",
};

describe.concurrent("control-plane worker automation run handling", () => {
  it("prepares a structured automation run context with rendered GitHub templates", async ({
    env,
  }) => {
    const scope = await seedAutomationRun({
      env,
      suffix: createSuffix("github_prepare"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      inputTemplate: "Handle {{payload.comment.body}}",
      instructions: "Always include a reproducible next step.",
      conversationKeyTemplate: "issue-{{payload.issue.number}}",
      idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
      payload: {
        issue: {
          number: 777,
        },
        comment: {
          body: "@mistlebot prepare",
        },
      },
      resolvedUserId: "usr_automation_github_prepare",
      externalEventId: "evt_github_prepare",
      externalDeliveryId: "delivery_github_prepare",
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    const preparedRun = await prepareAutomationRun(
      {
        db: env.controlPlaneDb,
      },
      {
        automationRunId: scope.automationRunId,
      },
    );

    expect(preparedRun).toMatchObject({
      automationRunId: scope.automationRunId,
      automationId: scope.automationId,
      conversationId: expect.stringMatching(/^cnv_/),
      automationTargetId: scope.automationTargetId,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      primaryRepositoryId: "mistlehq/platform",
      sourceKind: "webhook",
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      sourceWebhookEventId: scope.webhookEventId,
      sourceScheduledActionId: undefined,
      integrationConnectionId: scope.connectionId,
      targetKey: scope.targetKey,
      webhookEventId: scope.webhookEventId,
      webhookEventType: "github.issue_comment.created",
      webhookProviderEventType: "issue_comment",
      webhookExternalEventId: "evt_github_prepare",
      webhookExternalDeliveryId: "delivery_github_prepare",
      scheduledActionId: undefined,
      scheduledAt: undefined,
      localScheduledDate: undefined,
      localScheduledTime: undefined,
      actingUserId: "usr_automation_github_prepare",
      renderedInput: "Handle @mistlebot prepare",
      renderedConversationKey: "issue-777",
      renderedIdempotencyKey: "delivery_github_prepare",
      instructions: "Always include a reproducible next step.",
      collaborationModeSettings: {
        developerInstructions: "Always include a reproducible next step.",
      },
    });
    expect(preparedRun.webhookPayload).toEqual({
      issue: {
        number: 777,
      },
      comment: {
        body: "@mistlebot prepare",
      },
    });

    const persistedRun = await env.controlPlaneDb.query.automationRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.automationRunId),
    });
    const persistedConversation = await env.controlPlaneDb.query.automationConversations.findFirst({
      where: (table, { eq }) => eq(table.id, preparedRun.conversationId),
    });

    expect(persistedRun).toMatchObject({
      id: scope.automationRunId,
      conversationId: preparedRun.conversationId,
      renderedInput: "Handle @mistlebot prepare",
      renderedConversationKey: "issue-777",
      renderedIdempotencyKey: "delivery_github_prepare",
      instructions: "Always include a reproducible next step.",
    });
    expect(persistedConversation).toMatchObject({
      id: preparedRun.conversationId,
      organizationId: scope.organizationId,
      ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: scope.automationTargetId,
      createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
      createdById: scope.webhookEventId,
      sandboxProfileId: scope.sandboxProfileId,
      integrationFamilyId: OpenAiApiKeyDefinition.familyId,
      runtimeId: "codex",
      conversationKey: "issue-777",
      status: AutomationConversationStatuses.PENDING,
    });
  });

  it("renders Slack thread and fallback templates from the provider payload", async ({ env }) => {
    const threadScope = await seedAutomationRun({
      env,
      suffix: createSuffix("slack_thread"),
      familyId: "slack",
      variantId: "slack-default",
      targetConfig: {
        api_base_url: "https://slack.com/api",
      },
      connectionConfig: {
        connection_method: "slack-bot-token",
      },
      eventType: "slack:message",
      providerEventType: "message",
      inputTemplate: "Handle {{payload.event.text}}",
      conversationKeyTemplate:
        "slack:thread:{{payload.event.channel}}:{{payload.event.mistle_thread_root_ts}}",
      idempotencyKeyTemplate: "{{webhookEvent.externalEventId}}",
      payload: {
        event: {
          channel: "C123",
          ts: "1710000000.000100",
          mistle_thread_root_ts: "1710000000.000100",
          text: "@mistlebot prepare",
        },
      },
      externalEventId: "evt_slack_thread_prepare",
      externalDeliveryId: null,
      sourceOrderKey: "2026-03-09T00:00:00Z#0002",
    });
    const fallbackScope = await seedAutomationRun({
      env,
      suffix: createSuffix("slack_fallback"),
      familyId: "slack",
      variantId: "slack-default",
      targetConfig: {
        api_base_url: "https://slack.com/api",
      },
      connectionConfig: {
        connection_method: "slack-bot-token",
      },
      eventType: "slack:message",
      providerEventType: "message",
      inputTemplate:
        "Handle thread {{payload.event.thread_ts | default: payload.event.ts}}: {{payload.event.text}}",
      conversationKeyTemplate: "slack:channel:{{payload.event.channel}}",
      idempotencyKeyTemplate: "{{webhookEvent.externalEventId}}",
      payload: {
        event: {
          channel: "C123",
          ts: "1710000000.000200",
          text: "@mistlebot fallback",
        },
      },
      externalEventId: "evt_slack_fallback_prepare",
      externalDeliveryId: null,
      sourceOrderKey: "2026-03-09T00:00:00Z#0003",
    });

    const threadRun = await prepareAutomationRun(
      {
        db: env.controlPlaneDb,
      },
      {
        automationRunId: threadScope.automationRunId,
      },
    );
    const fallbackRun = await prepareAutomationRun(
      {
        db: env.controlPlaneDb,
      },
      {
        automationRunId: fallbackScope.automationRunId,
      },
    );

    expect(threadRun).toMatchObject({
      automationRunId: threadScope.automationRunId,
      renderedInput: "Handle @mistlebot prepare",
      renderedConversationKey: "slack:thread:C123:1710000000.000100",
      renderedIdempotencyKey: "evt_slack_thread_prepare",
    });
    expect(fallbackRun).toMatchObject({
      automationRunId: fallbackScope.automationRunId,
      renderedInput: "Handle thread 1710000000.000200: @mistlebot fallback",
      renderedConversationKey: "slack:channel:C123",
      renderedIdempotencyKey: "evt_slack_fallback_prepare",
    });
  });

  it("reuses persisted rendered snapshots when replaying a running run", async ({ env }) => {
    const scope = await seedAutomationRun({
      env,
      suffix: createSuffix("replay_snapshot"),
      status: AutomationRunStatuses.RUNNING,
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      inputTemplate: "Handle {{payload.comment.body}}",
      instructions: "Mention the automation marker `AUTOMATION_ONLY` exactly once.",
      conversationKeyTemplate: "issue-{{payload.issue.number}}",
      idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
      payload: {
        issue: {
          number: 105,
        },
        comment: {
          body: "@mistlebot replay snapshot",
        },
      },
      externalEventId: "evt_replay_snapshot",
      externalDeliveryId: "delivery_replay_snapshot",
      sourceOrderKey: "2026-03-09T00:00:00Z#0004",
    });

    const firstPreparedRun = await prepareAutomationRun(
      {
        db: env.controlPlaneDb,
      },
      {
        automationRunId: scope.automationRunId,
      },
    );

    await env.controlPlaneDb
      .update(env.controlPlaneTables.webhookAutomations)
      .set({
        inputTemplate: "Changed {{payload.comment.body}}",
        instructions: "Changed automation instructions should not replay.",
        conversationKeyTemplate: "changed-issue-{{payload.issue.number}}",
        idempotencyKeyTemplate: "changed-{{webhookEvent.externalDeliveryId}}",
      })
      .where(eq(env.controlPlaneTables.webhookAutomations.automationId, scope.automationId));

    const replayPreparedRun = await prepareAutomationRun(
      {
        db: env.controlPlaneDb,
      },
      {
        automationRunId: scope.automationRunId,
      },
    );
    const persistedRun = await env.controlPlaneDb.query.automationRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.automationRunId),
    });

    expect(replayPreparedRun).toEqual(firstPreparedRun);
    expect(persistedRun).toMatchObject({
      id: scope.automationRunId,
      conversationId: firstPreparedRun.conversationId,
      renderedInput: "Handle @mistlebot replay snapshot",
      renderedConversationKey: "issue-105",
      renderedIdempotencyKey: "delivery_replay_snapshot",
      instructions: "Mention the automation marker `AUTOMATION_ONLY` exactly once.",
    });
  });

  it("hands off queued runs to conversation delivery", async ({ env }) => {
    const scope = await seedAutomationRun({
      env,
      suffix: createSuffix("handoff"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      inputTemplate: "Handle {{payload.comment.body}}",
      conversationKeyTemplate: "issue-{{payload.issue.number}}",
      idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
      payload: {
        issue: {
          number: 99,
        },
        comment: {
          body: "@mistlebot run",
        },
      },
      externalEventId: "evt_handoff",
      externalDeliveryId: "delivery_handoff",
      sourceOrderKey: "2026-03-09T00:00:00Z#0005",
    });

    const preparedAutomationRun = await prepareAndHandoffAutomationRun({
      env,
      automationRunId: scope.automationRunId,
    });
    expect(preparedAutomationRun).not.toBeNull();

    const persistedRun = await env.controlPlaneDb.query.automationRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.automationRunId),
    });
    const persistedTask =
      await env.controlPlaneDb.query.automationConversationDeliveryTasks.findFirst({
        where: (table, { eq }) => eq(table.automationRunId, scope.automationRunId),
      });
    const persistedProcessor =
      await env.controlPlaneDb.query.automationConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
      });

    expect(persistedRun).toMatchObject({
      id: scope.automationRunId,
      status: AutomationRunStatuses.RUNNING,
      finishedAt: null,
      failureCode: null,
    });
    expect(persistedRun?.startedAt).not.toBeNull();
    expect(persistedTask).toMatchObject({
      automationRunId: scope.automationRunId,
      status: AutomationConversationDeliveryTaskStatuses.QUEUED,
      failureCode: null,
    });
    expect(persistedTask?.id).toBe(preparedAutomationRun?.deliveryTaskId);
    expect(persistedProcessor).toMatchObject({
      conversationId: persistedRun?.conversationId,
      status: AutomationConversationDeliveryProcessorStatuses.RUNNING,
    });
  });

  it("marks runs failed when template rendering fails", async ({ env }) => {
    const scope = await seedAutomationRun({
      env,
      suffix: createSuffix("template_failure"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      inputTemplate: "Handle {{payload.comment.missing_field}}",
      conversationKeyTemplate: "issue-{{payload.issue.number}}",
      idempotencyKeyTemplate: null,
      payload: {
        issue: {
          number: 100,
        },
        comment: {
          body: "@mistlebot run",
        },
      },
      externalEventId: "evt_template_failure",
      externalDeliveryId: "delivery_template_failure",
      sourceOrderKey: "2026-03-09T00:00:00Z#0006",
    });

    await expect(
      prepareAndHandoffAutomationRun({
        env,
        automationRunId: scope.automationRunId,
      }),
    ).rejects.toThrow("undefined variable: payload.comment.missing_field");

    const persistedRun = await env.controlPlaneDb.query.automationRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.automationRunId),
    });
    const persistedTasks =
      await env.controlPlaneDb.query.automationConversationDeliveryTasks.findMany({
        where: (table, { eq }) => eq(table.automationRunId, scope.automationRunId),
      });

    expect(persistedRun).toMatchObject({
      id: scope.automationRunId,
      status: AutomationRunStatuses.FAILED,
      failureCode: "template_render_failed",
    });
    expect(persistedRun?.finishedAt).not.toBeNull();
    expect(persistedTasks).toHaveLength(0);
  });
});

async function prepareAndHandoffAutomationRun(input: {
  env: IntegrationTestEnvironment;
  automationRunId: string;
}) {
  const workflowInput = {
    automationRunId: input.automationRunId,
  };
  const transitionResult = await transitionAutomationRunToRunning(
    {
      db: input.env.controlPlaneDb,
    },
    workflowInput,
  );
  if (!transitionResult.shouldProcess) {
    return null;
  }

  try {
    const preparedAutomationRun = await prepareAutomationRun(
      {
        db: input.env.controlPlaneDb,
      },
      workflowInput,
    );
    const deliveryHandoff = await handoffAutomationRunDelivery(
      {
        db: input.env.controlPlaneDb,
      },
      {
        preparedAutomationRun,
      },
    );
    return {
      ...preparedAutomationRun,
      deliveryTaskId: deliveryHandoff.deliveryTaskId,
    };
  } catch (error) {
    const failure = resolveAutomationRunFailure(error);
    await markAutomationRunFailed(
      {
        db: input.env.controlPlaneDb,
      },
      {
        automationRunId: workflowInput.automationRunId,
        failureCode: failure.code,
        failureMessage: failure.message,
      },
    );
    throw error;
  }
}

type SeedAutomationRunInput = {
  env: IntegrationTestEnvironment;
  suffix: string;
  status?: typeof AutomationRunStatuses.QUEUED | typeof AutomationRunStatuses.RUNNING;
  familyId: string;
  variantId: string;
  targetConfig: Record<string, unknown>;
  connectionConfig: Record<string, unknown>;
  eventType: string;
  providerEventType: string;
  inputTemplate: string;
  instructions?: string;
  conversationKeyTemplate: string;
  idempotencyKeyTemplate: string | null;
  payload: Record<string, unknown>;
  resolvedUserId?: string;
  externalEventId: string;
  externalDeliveryId: string | null;
  sourceOrderKey: string;
};

type SeededAutomationRun = {
  organizationId: string;
  sandboxProfileId: string;
  automationId: string;
  automationTargetId: string;
  webhookEventId: string;
  automationRunId: string;
  connectionId: string;
  webhookSourceId: string;
  targetKey: string;
};

async function seedAutomationRun(input: SeedAutomationRunInput): Promise<SeededAutomationRun> {
  const organizationId = `org_${input.suffix}`;
  const sandboxProfileId = `sbp_${input.suffix}`;
  const automationId = `atm_${input.suffix}`;
  const automationTargetId = `atg_${input.suffix}`;
  const webhookEventId = `iwe_${input.suffix}`;
  const automationRunId = `aru_${input.suffix}`;
  const connectionId = `icn_${input.suffix}`;
  const webhookSourceId = `iws_${input.suffix}`;
  const targetKey = `${input.variantId}-${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Worker Automation ${input.suffix}`,
    slug: `worker-automation-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Automation ${input.suffix} Profile`,
    status: "active",
  });
  await seedOpenAiAgentBinding({
    env: input.env,
    organizationId,
    sandboxProfileId,
    sandboxProfileVersion: 7,
    suffix: input.suffix,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: input.familyId,
    variantId: input.variantId,
    enabled: true,
    config: input.targetConfig,
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: connectionId,
      organizationId,
      targetKey,
      displayName: `Worker automation ${input.suffix} connection`,
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: `${input.suffix}-subject`,
      config: input.connectionConfig,
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookSources)
    .values({
      id: webhookSourceId,
      organizationId,
      integrationConnectionId: connectionId,
      targetKey,
      endpointKey: `${webhookSourceId}-endpoint`,
      status: "active",
    });
  if (input.resolvedUserId !== undefined) {
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.users).values({
      id: input.resolvedUserId,
      name: `Automation ${input.suffix} Actor`,
      email: `${input.resolvedUserId}@example.com`,
      emailVerified: true,
    });
  }
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Automation ${input.suffix}`,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.webhookAutomations).values({
    automationId,
    integrationWebhookSourceId: webhookSourceId,
    eventTypes: [input.eventType],
    payloadFilter: null,
    inputTemplate: input.inputTemplate,
    instructions: input.instructions,
    conversationKeyTemplate: input.conversationKeyTemplate,
    idempotencyKeyTemplate: input.idempotencyKeyTemplate,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 7,
    primaryRepositoryId: "mistlehq/platform",
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookEvents)
    .values({
      id: webhookEventId,
      organizationId,
      integrationConnectionId: connectionId,
      integrationWebhookSourceId: webhookSourceId,
      targetKey,
      eventType: input.eventType,
      providerEventType: input.providerEventType,
      externalEventId: input.externalEventId,
      externalDeliveryId: input.externalDeliveryId,
      sourceOccurredAt: "2026-03-09T00:00:00.000Z",
      sourceOrderKey: input.sourceOrderKey,
      payload: input.payload,
      resolvedUserId: input.resolvedUserId,
      status: "processed",
    });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.automationRuns).values({
    id: automationRunId,
    automationId,
    automationTargetId,
    sourceWebhookEventId: webhookEventId,
    status: input.status ?? AutomationRunStatuses.QUEUED,
  });

  return {
    organizationId,
    sandboxProfileId,
    automationId,
    automationTargetId,
    webhookEventId,
    automationRunId,
    connectionId,
    webhookSourceId,
    targetKey,
  };
}

async function seedOpenAiAgentBinding(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  suffix: string;
}): Promise<void> {
  const targetKey = `openai-agent-${input.suffix}`;
  const connectionId = `icn_openai_agent_${input.suffix}`;
  const bindingId = `ibd_openai_agent_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: OpenAiApiKeyDefinition.familyId,
    variantId: OpenAiApiKeyDefinition.variantId,
    enabled: true,
    config: OpenAiAgentTargetConfig,
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: connectionId,
      organizationId: input.organizationId,
      targetKey,
      displayName: "OpenAI agent connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: "openai-agent-subject",
      config: {
        connection_method: "api-key",
      },
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersions)
    .values({
      sandboxProfileId: input.sandboxProfileId,
      version: input.sandboxProfileVersion,
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
      },
    });
}

function createSuffix(label: string): string {
  return `integration_new_${label}`;
}
