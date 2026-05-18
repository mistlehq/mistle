/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerConversationCreatedByKinds,
  TriggerConversationDeliveryProcessorStatuses,
  TriggerConversationDeliveryTaskStatuses,
  TriggerConversationOwnerKinds,
  TriggerConversationStatuses,
  TriggerKinds,
  TriggerRunStatuses,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionAgentRuntimeIds,
} from "@mistle/db/control-plane";
import { OpenAiApiKeyDefinition } from "@mistle/integrations-definitions";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { handoffTriggerRunDelivery } from "../openworkflow/handle-trigger-run/handoff-trigger-run-delivery.js";
import { transitionTriggerRunToRunning } from "../openworkflow/handle-trigger-run/transition-trigger-run-to-running.js";
import {
  markTriggerRunFailed,
  prepareTriggerRun,
  resolveTriggerRunFailure,
} from "../openworkflow/shared/trigger-run.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

const OpenAiAgentTargetConfig = {
  api_base_url: "https://api.openai.com/v1",
};
const AnthropicAgentTargetConfig = {};
const OpenCodeAgentTargetConfig = {};

describe.concurrent("control-plane worker trigger run handling", () => {
  it("prepares a structured trigger run context with rendered GitHub templates", async ({
    env,
  }) => {
    const scope = await seedTriggerRun({
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
      resolvedUserId: "usr_trigger_github_prepare",
      externalEventId: "evt_github_prepare",
      externalDeliveryId: "delivery_github_prepare",
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
    });

    const preparedRun = await prepareTriggerRun(
      {
        db: env.controlPlaneDb,
      },
      {
        triggerRunId: scope.triggerRunId,
      },
    );

    expect(preparedRun).toMatchObject({
      triggerRunId: scope.triggerRunId,
      triggerId: scope.triggerId,
      conversationId: expect.stringMatching(/^cnv_/),
      triggerTargetId: scope.triggerTargetId,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      primaryRepositoryId: "mistlehq/platform",
      workingDirectory: "/root/mistlehq/platform",
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
      actingUserId: "usr_trigger_github_prepare",
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

    const persistedRun = await env.controlPlaneDb.query.triggerRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.triggerRunId),
    });
    const persistedConversation = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, preparedRun.conversationId),
    });

    expect(persistedRun).toMatchObject({
      id: scope.triggerRunId,
      conversationId: preparedRun.conversationId,
      renderedInput: "Handle @mistlebot prepare",
      renderedConversationKey: "issue-777",
      renderedIdempotencyKey: "delivery_github_prepare",
      instructions: "Always include a reproducible next step.",
    });
    expect(persistedConversation).toMatchObject({
      id: preparedRun.conversationId,
      organizationId: scope.organizationId,
      ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
      ownerId: scope.triggerTargetId,
      createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
      createdById: scope.webhookEventId,
      sandboxProfileId: scope.sandboxProfileId,
      integrationFamilyId: OpenAiApiKeyDefinition.familyId,
      runtimeId: "codex",
      conversationKey: "issue-777",
      status: TriggerConversationStatuses.PENDING,
    });
  });

  it("prepares trigger runs when the profile has multiple agent provider bindings", async ({
    env,
  }) => {
    const scope = await seedTriggerRun({
      env,
      suffix: createSuffix("multi_agent_prepare"),
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
          number: 778,
        },
        comment: {
          body: "@mistlebot prepare with providers",
        },
      },
      externalEventId: "evt_multi_agent_prepare",
      externalDeliveryId: "delivery_multi_agent_prepare",
      sourceOrderKey: "2026-03-09T00:00:00Z#0010",
    });
    await seedAnthropicAgentBinding({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      suffix: "multi_agent_prepare",
    });
    await seedOpenCodeAgentBinding({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      suffix: "multi_agent_prepare",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sandboxProfileVersions)
      .set({
        agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      })
      .where(
        eq(env.controlPlaneTables.sandboxProfileVersions.sandboxProfileId, scope.sandboxProfileId),
      );

    const preparedRun = await prepareTriggerRun(
      {
        db: env.controlPlaneDb,
      },
      {
        triggerRunId: scope.triggerRunId,
      },
    );
    const persistedConversation = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, preparedRun.conversationId),
    });

    expect(preparedRun).toMatchObject({
      triggerRunId: scope.triggerRunId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      renderedInput: "Handle @mistlebot prepare with providers",
    });
    expect(persistedConversation).toMatchObject({
      id: preparedRun.conversationId,
      sandboxProfileId: scope.sandboxProfileId,
      integrationFamilyId: "opencode",
      runtimeId: "opencode",
    });
  });

  it("rejects duplicate agent provider bindings before preparing trigger runs", async ({ env }) => {
    const scope = await seedTriggerRun({
      env,
      suffix: createSuffix("duplicate_agent_prepare"),
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
          number: 779,
        },
        comment: {
          body: "@mistlebot prepare duplicate providers",
        },
      },
      externalEventId: "evt_duplicate_agent_prepare",
      externalDeliveryId: "delivery_duplicate_agent_prepare",
      sourceOrderKey: "2026-03-09T00:00:00Z#0011",
    });
    await seedDuplicateOpenAiAgentBinding({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      suffix: "duplicate_agent_prepare",
    });

    let failure: { code: string; message: string } | null = null;
    try {
      await prepareTriggerRun(
        {
          db: env.controlPlaneDb,
        },
        {
          triggerRunId: scope.triggerRunId,
        },
      );
    } catch (error) {
      failure = resolveTriggerRunFailure(error);
    }

    expect(failure?.code).toBe("agent_binding_ambiguous");
    expect(failure?.message).toContain("duplicates provider 'openai'");
  });

  it("rejects agent provider bindings that are incompatible with the profile runtime", async ({
    env,
  }) => {
    const scope = await seedTriggerRun({
      env,
      suffix: createSuffix("incompatible_agent_prepare"),
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
          number: 781,
        },
        comment: {
          body: "@mistlebot prepare incompatible provider",
        },
      },
      externalEventId: "evt_incompatible_agent_prepare",
      externalDeliveryId: "delivery_incompatible_agent_prepare",
      sourceOrderKey: "2026-03-09T00:00:00Z#0013",
    });
    await seedAnthropicAgentBinding({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      suffix: "incompatible_agent_prepare",
    });

    let failure: { code: string; message: string } | null = null;
    try {
      await prepareTriggerRun(
        {
          db: env.controlPlaneDb,
        },
        {
          triggerRunId: scope.triggerRunId,
        },
      );
    } catch (error) {
      failure = resolveTriggerRunFailure(error);
    }

    expect(failure?.code).toBe("agent_binding_runtime_incompatible");
    expect(failure?.message).toContain(
      "provider 'anthropic' that is not compatible with runtime 'codex'",
    );
  });

  it("rejects trigger runs when the runtime primary agent provider is missing", async ({ env }) => {
    const scope = await seedTriggerRun({
      env,
      suffix: createSuffix("missing_primary_agent_prepare"),
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
          number: 780,
        },
        comment: {
          body: "@mistlebot prepare without primary provider",
        },
      },
      externalEventId: "evt_missing_primary_agent_prepare",
      externalDeliveryId: "delivery_missing_primary_agent_prepare",
      sourceOrderKey: "2026-03-09T00:00:00Z#0012",
    });
    await env.controlPlaneDb
      .delete(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .where(
        eq(
          env.controlPlaneTables.sandboxProfileVersionIntegrationBindings.id,
          "ibd_openai_agent_integration_new_missing_primary_agent_prepare",
        ),
      );
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sandboxProfileVersions)
      .set({
        agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      })
      .where(
        eq(env.controlPlaneTables.sandboxProfileVersions.sandboxProfileId, scope.sandboxProfileId),
      );
    await seedAnthropicAgentBinding({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: 7,
      suffix: "missing_primary_agent_prepare",
    });

    let failure: { code: string; message: string } | null = null;
    try {
      await prepareTriggerRun(
        {
          db: env.controlPlaneDb,
        },
        {
          triggerRunId: scope.triggerRunId,
        },
      );
    } catch (error) {
      failure = resolveTriggerRunFailure(error);
    }

    expect(failure?.code).toBe("agent_binding_not_found");
    expect(failure?.message).toContain("requires an AGENT binding for provider 'opencode'");
  });

  it("renders Slack thread and fallback templates from the provider payload", async ({ env }) => {
    const threadScope = await seedTriggerRun({
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
    const fallbackScope = await seedTriggerRun({
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

    const threadRun = await prepareTriggerRun(
      {
        db: env.controlPlaneDb,
      },
      {
        triggerRunId: threadScope.triggerRunId,
      },
    );
    const fallbackRun = await prepareTriggerRun(
      {
        db: env.controlPlaneDb,
      },
      {
        triggerRunId: fallbackScope.triggerRunId,
      },
    );

    expect(threadRun).toMatchObject({
      triggerRunId: threadScope.triggerRunId,
      renderedInput: "Handle @mistlebot prepare",
      renderedConversationKey: "slack:thread:C123:1710000000.000100",
      renderedIdempotencyKey: "evt_slack_thread_prepare",
    });
    expect(fallbackRun).toMatchObject({
      triggerRunId: fallbackScope.triggerRunId,
      renderedInput: "Handle thread 1710000000.000200: @mistlebot fallback",
      renderedConversationKey: "slack:channel:C123",
      renderedIdempotencyKey: "evt_slack_fallback_prepare",
    });
  });

  it("reuses persisted rendered snapshots when replaying a running run", async ({ env }) => {
    const scope = await seedTriggerRun({
      env,
      suffix: createSuffix("replay_snapshot"),
      status: TriggerRunStatuses.RUNNING,
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
      instructions: "Mention the trigger marker `TRIGGER_ONLY` exactly once.",
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

    const firstPreparedRun = await prepareTriggerRun(
      {
        db: env.controlPlaneDb,
      },
      {
        triggerRunId: scope.triggerRunId,
      },
    );

    await env.controlPlaneDb
      .update(env.controlPlaneTables.webhookTriggers)
      .set({
        inputTemplate: "Changed {{payload.comment.body}}",
        instructions: "Changed trigger instructions should not replay.",
        conversationKeyTemplate: "changed-issue-{{payload.issue.number}}",
        idempotencyKeyTemplate: "changed-{{webhookEvent.externalDeliveryId}}",
      })
      .where(eq(env.controlPlaneTables.webhookTriggers.triggerId, scope.triggerId));

    const replayPreparedRun = await prepareTriggerRun(
      {
        db: env.controlPlaneDb,
      },
      {
        triggerRunId: scope.triggerRunId,
      },
    );
    const persistedRun = await env.controlPlaneDb.query.triggerRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.triggerRunId),
    });

    expect(replayPreparedRun).toEqual(firstPreparedRun);
    expect(persistedRun).toMatchObject({
      id: scope.triggerRunId,
      conversationId: firstPreparedRun.conversationId,
      renderedInput: "Handle @mistlebot replay snapshot",
      renderedConversationKey: "issue-105",
      renderedIdempotencyKey: "delivery_replay_snapshot",
      instructions: "Mention the trigger marker `TRIGGER_ONLY` exactly once.",
    });
  });

  it("hands off queued runs to conversation delivery", async ({ env }) => {
    const scope = await seedTriggerRun({
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

    const preparedTriggerRun = await prepareAndHandoffTriggerRun({
      env,
      triggerRunId: scope.triggerRunId,
    });
    expect(preparedTriggerRun).not.toBeNull();

    const persistedRun = await env.controlPlaneDb.query.triggerRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.triggerRunId),
    });
    const persistedTask = await env.controlPlaneDb.query.triggerConversationDeliveryTasks.findFirst(
      {
        where: (table, { eq }) => eq(table.triggerRunId, scope.triggerRunId),
      },
    );
    const persistedProcessor =
      await env.controlPlaneDb.query.triggerConversationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.conversationId, persistedRun?.conversationId ?? ""),
      });

    expect(persistedRun).toMatchObject({
      id: scope.triggerRunId,
      status: TriggerRunStatuses.RUNNING,
      finishedAt: null,
      failureCode: null,
    });
    expect(persistedRun?.startedAt).not.toBeNull();
    expect(persistedTask).toMatchObject({
      triggerRunId: scope.triggerRunId,
      status: TriggerConversationDeliveryTaskStatuses.QUEUED,
      failureCode: null,
    });
    expect(persistedTask?.id).toBe(preparedTriggerRun?.deliveryTaskId);
    expect(persistedProcessor).toMatchObject({
      conversationId: persistedRun?.conversationId,
      status: TriggerConversationDeliveryProcessorStatuses.RUNNING,
    });
  });

  it("marks runs failed when template rendering fails", async ({ env }) => {
    const scope = await seedTriggerRun({
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
      prepareAndHandoffTriggerRun({
        env,
        triggerRunId: scope.triggerRunId,
      }),
    ).rejects.toThrow("undefined variable: payload.comment.missing_field");

    const persistedRun = await env.controlPlaneDb.query.triggerRuns.findFirst({
      where: (table, { eq }) => eq(table.id, scope.triggerRunId),
    });
    const persistedTasks = await env.controlPlaneDb.query.triggerConversationDeliveryTasks.findMany(
      {
        where: (table, { eq }) => eq(table.triggerRunId, scope.triggerRunId),
      },
    );

    expect(persistedRun).toMatchObject({
      id: scope.triggerRunId,
      status: TriggerRunStatuses.FAILED,
      failureCode: "template_render_failed",
    });
    expect(persistedRun?.finishedAt).not.toBeNull();
    expect(persistedTasks).toHaveLength(0);
  });
});

async function prepareAndHandoffTriggerRun(input: {
  env: IntegrationTestEnvironment;
  triggerRunId: string;
}) {
  const workflowInput = {
    triggerRunId: input.triggerRunId,
  };
  const transitionResult = await transitionTriggerRunToRunning(
    {
      db: input.env.controlPlaneDb,
    },
    workflowInput,
  );
  if (!transitionResult.shouldProcess) {
    return null;
  }

  try {
    const preparedTriggerRun = await prepareTriggerRun(
      {
        db: input.env.controlPlaneDb,
      },
      workflowInput,
    );
    const deliveryHandoff = await handoffTriggerRunDelivery(
      {
        db: input.env.controlPlaneDb,
      },
      {
        preparedTriggerRun,
      },
    );
    return {
      ...preparedTriggerRun,
      deliveryTaskId: deliveryHandoff.deliveryTaskId,
    };
  } catch (error) {
    const failure = resolveTriggerRunFailure(error);
    await markTriggerRunFailed(
      {
        db: input.env.controlPlaneDb,
      },
      {
        triggerRunId: workflowInput.triggerRunId,
        failureCode: failure.code,
        failureMessage: failure.message,
      },
    );
    throw error;
  }
}

type SeedTriggerRunInput = {
  env: IntegrationTestEnvironment;
  suffix: string;
  status?: typeof TriggerRunStatuses.QUEUED | typeof TriggerRunStatuses.RUNNING;
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

type SeededTriggerRun = {
  organizationId: string;
  sandboxProfileId: string;
  triggerId: string;
  triggerTargetId: string;
  webhookEventId: string;
  triggerRunId: string;
  connectionId: string;
  webhookSourceId: string;
  targetKey: string;
};

async function seedTriggerRun(input: SeedTriggerRunInput): Promise<SeededTriggerRun> {
  const organizationId = `org_${input.suffix}`;
  const sandboxProfileId = `sbp_${input.suffix}`;
  const triggerId = `atm_${input.suffix}`;
  const triggerTargetId = `atg_${input.suffix}`;
  const webhookEventId = `iwe_${input.suffix}`;
  const triggerRunId = `aru_${input.suffix}`;
  const connectionId = `icn_${input.suffix}`;
  const webhookSourceId = `iws_${input.suffix}`;
  const targetKey = `${input.variantId}-${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Worker Trigger ${input.suffix}`,
    slug: `worker-trigger-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Trigger ${input.suffix} Profile`,
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
      displayName: `Worker trigger ${input.suffix} connection`,
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
      name: `Trigger ${input.suffix} Actor`,
      email: `${input.resolvedUserId}@example.com`,
      emailVerified: true,
    });
  }
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: triggerId,
    organizationId,
    kind: TriggerKinds.WEBHOOK,
    name: `Trigger ${input.suffix}`,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.webhookTriggers).values({
    triggerId,
    integrationWebhookSourceId: webhookSourceId,
    eventTypes: [input.eventType],
    payloadFilter: null,
    inputTemplate: input.inputTemplate,
    instructions: input.instructions,
    conversationKeyTemplate: input.conversationKeyTemplate,
    idempotencyKeyTemplate: input.idempotencyKeyTemplate,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerTargets).values({
    id: triggerTargetId,
    triggerId,
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
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerRuns).values({
    id: triggerRunId,
    triggerId,
    triggerTargetId,
    sourceWebhookEventId: webhookEventId,
    status: input.status ?? TriggerRunStatuses.QUEUED,
  });

  return {
    organizationId,
    sandboxProfileId,
    triggerId,
    triggerTargetId,
    webhookEventId,
    triggerRunId,
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
      config: {},
    });
}

async function seedAnthropicAgentBinding(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  suffix: string;
}): Promise<void> {
  const targetKey = `anthropic-agent-${input.suffix}`;
  const connectionId = `icn_anthropic_agent_${input.suffix}`;
  const bindingId = `ibd_anthropic_agent_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: "anthropic",
    variantId: "anthropic-default",
    enabled: true,
    config: AnthropicAgentTargetConfig,
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: connectionId,
      organizationId: input.organizationId,
      targetKey,
      displayName: "Anthropic agent connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: "anthropic-agent-subject",
      config: {
        connection_method: "api-key",
      },
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {},
    });
}

async function seedDuplicateOpenAiAgentBinding(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  suffix: string;
}): Promise<void> {
  const targetKey = `openai-agent-duplicate-${input.suffix}`;
  const connectionId = `icn_openai_agent_duplicate_${input.suffix}`;
  const bindingId = `ibd_openai_agent_duplicate_${input.suffix}`;

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
      displayName: "Duplicate OpenAI agent connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: "duplicate-openai-agent-subject",
      config: {
        connection_method: "api-key",
      },
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {},
    });
}

async function seedOpenCodeAgentBinding(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  suffix: string;
}): Promise<void> {
  const targetKey = `opencode-agent-${input.suffix}`;
  const connectionId = `icn_opencode_agent_${input.suffix}`;
  const bindingId = `ibd_opencode_agent_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values({
    targetKey,
    familyId: "opencode",
    variantId: "opencode-go",
    enabled: true,
    config: OpenCodeAgentTargetConfig,
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationConnections)
    .values({
      id: connectionId,
      organizationId: input.organizationId,
      targetKey,
      displayName: "OpenCode agent connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: "opencode-agent-subject",
      config: {
        connection_method: "api-key",
      },
    });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values({
      id: bindingId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      connectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {},
    });
}

function createSuffix(label: string): string {
  return `integration_new_${label}`;
}
