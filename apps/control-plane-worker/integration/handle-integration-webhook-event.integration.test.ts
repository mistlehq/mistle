/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerKinds,
  TriggerRunStatuses,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationWebhookEventStatuses,
} from "@mistle/db/control-plane";
import {
  createIntegrationRegistry,
  OpenAiApiKeyDefinition,
} from "@mistle/integrations-definitions/server";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { prepareIntegrationWebhookEvent } from "../openworkflow/handle-integration-webhook-event/prepare-integration-webhook-event.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

const OpenAiAgentTargetConfig = {
  api_base_url: "https://api.openai.com/v1",
};

describe.concurrent("control-plane worker integration webhook event handling", () => {
  it("queues trigger runs for matching webhook triggers", async ({ env }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("queue"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      payloadFilter: {
        "github.issue_comment.created": {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
      },
      payload: {
        installation: {
          id: 12345,
        },
        delivery: {
          id: "delivery_queue_payload",
        },
        comment: {
          body: "please run @mistlebot",
        },
      },
      externalEventId: "evt_queue",
      externalDeliveryId: "delivery_queue",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      externalDeliveryId: "delivery_queue",
      integrationConnectionId: scope.connectionId,
      targetKey: scope.targetKey,
      webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
      finalized: false,
      resourceSyncRequests: [],
    });
    expect(preparedEvent.triggerRunIds).toHaveLength(1);

    const queuedRuns = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
    });
    expect(queuedRuns).toHaveLength(1);
    expect(queuedRuns[0]).toMatchObject({
      triggerId: scope.triggerId,
      triggerTargetId: scope.triggerTargetId,
      status: TriggerRunStatuses.QUEUED,
    });
  });

  it("marks webhook events ignored when no trigger targets or sync triggers match", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("ignore"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      payloadFilter: {
        "github.issue_comment.created": {
          op: "contains_token",
          path: ["comment", "body"],
          value: "@mistlebot",
        },
      },
      payload: {
        comment: {
          body: "nothing to match",
        },
      },
      externalEventId: "evt_ignore",
      externalDeliveryId: "delivery_ignore",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toEqual({
      webhookEventId: scope.webhookEventId,
      externalDeliveryId: "delivery_ignore",
      integrationConnectionId: scope.connectionId,
      targetKey: scope.targetKey,
      webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
      triggerRunIds: [],
      resourceSyncRequests: [],
      finalized: true,
    });

    const persistedEvent = await env.controlPlaneDb.query.integrationWebhookEvents.findFirst({
      where: (table, { eq }) => eq(table.id, scope.webhookEventId),
    });
    expect(persistedEvent).toMatchObject({
      status: IntegrationWebhookEventStatuses.IGNORED,
    });
    expect(persistedEvent?.finalizedAt).not.toBeNull();
  });

  it("ignores Slack message subtypes when the trigger listens for plain messages", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("slack_subtype"),
      familyId: "slack",
      variantId: "slack-default",
      targetConfig: {
        api_base_url: "https://slack.com/api",
      },
      connectionConfig: {
        connection_method: "slack-bot-token",
      },
      eventType: "slack:message_deleted",
      providerEventType: "message_deleted",
      triggerEventTypes: ["slack:message"],
      payloadFilter: null,
      payload: {
        event: {
          channel: "C123",
          text: "deleted",
          subtype: "message_deleted",
        },
      },
      externalEventId: "evt_slack_message_deleted",
      externalDeliveryId: null,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent.triggerRunIds).toEqual([]);
    expect(preparedEvent.webhookEventStatus).toBe(IntegrationWebhookEventStatuses.IGNORED);

    const queuedRuns = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
    });
    expect(queuedRuns).toHaveLength(0);
  });

  it("returns resource sync requests for webhook-triggered provider resources", async ({ env }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("resource_sync"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.installation_repositories.added",
      providerEventType: "installation_repositories",
      createTrigger: false,
      payload: {
        installation: {
          id: 12345,
        },
      },
      externalEventId: "evt_resource_sync",
      externalDeliveryId: "delivery_resource_sync",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
      triggerRunIds: [],
      finalized: false,
    });
    expect(preparedEvent.resourceSyncRequests).toEqual([
      {
        organizationId: scope.organizationId,
        connectionId: scope.connectionId,
        kind: "repository",
      },
    ]);
  });
});

type SeedWebhookEventScopeInput = {
  env: IntegrationTestEnvironment;
  suffix: string;
  familyId: string;
  variantId: string;
  targetConfig: Record<string, unknown>;
  connectionConfig: Record<string, unknown>;
  eventType: string;
  providerEventType: string;
  triggerEventTypes?: ReadonlyArray<string>;
  payloadFilter?: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  externalEventId: string;
  externalDeliveryId: string | null;
  createTrigger?: boolean;
};

type SeededWebhookEventScope = {
  organizationId: string;
  sandboxProfileId: string;
  triggerId: string;
  triggerTargetId: string;
  webhookEventId: string;
  connectionId: string;
  webhookSourceId: string;
  targetKey: string;
};

async function seedWebhookEventScope(
  input: SeedWebhookEventScopeInput,
): Promise<SeededWebhookEventScope> {
  const organizationId = `org_${input.suffix}`;
  const sandboxProfileId = `sbp_${input.suffix}`;
  const triggerId = `atm_${input.suffix}`;
  const triggerTargetId = `atg_${input.suffix}`;
  const webhookEventId = `iwe_${input.suffix}`;
  const connectionId = `icn_${input.suffix}`;
  const webhookSourceId = `iws_${input.suffix}`;
  const targetKey = `${input.variantId}-${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Worker Webhook ${input.suffix}`,
    slug: `worker-webhook-${input.suffix}`,
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
      displayName: `Worker webhook ${input.suffix} connection`,
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

  if (input.createTrigger !== false) {
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
      id: sandboxProfileId,
      organizationId,
      displayName: `Worker Webhook ${input.suffix} Profile`,
      status: "active",
    });
    await seedOpenAiAgentBinding({
      env: input.env,
      organizationId,
      sandboxProfileId,
      sandboxProfileVersion: 2,
      suffix: input.suffix,
    });
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
      id: triggerId,
      organizationId,
      kind: TriggerKinds.WEBHOOK,
      name: `Worker Webhook ${input.suffix} Trigger`,
      enabled: true,
    });
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.webhookTriggers).values({
      triggerId,
      integrationWebhookSourceId: webhookSourceId,
      eventTypes: [...(input.triggerEventTypes ?? [input.eventType])],
      payloadFilter: input.payloadFilter ?? null,
      inputTemplate: "Handle webhook event",
      conversationKeyTemplate: "github/{{payload.installation.id}}",
      idempotencyKeyTemplate: "{{webhookEvent.externalDeliveryId}}",
    });
    await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerTargets).values({
      id: triggerTargetId,
      triggerId,
      sandboxProfileId,
      sandboxProfileVersion: 2,
    });
  }

  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.integrationWebhookEvents)
    .values({
      id: webhookEventId,
      organizationId,
      integrationConnectionId: connectionId,
      integrationWebhookSourceId: webhookSourceId,
      targetKey,
      externalEventId: input.externalEventId,
      externalDeliveryId: input.externalDeliveryId,
      providerEventType: input.providerEventType,
      eventType: input.eventType,
      payload: input.payload,
      sourceOccurredAt: "2026-03-09T00:00:00.000Z",
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      status: IntegrationWebhookEventStatuses.RECEIVED,
    });

  return {
    organizationId,
    sandboxProfileId,
    triggerId,
    triggerTargetId,
    webhookEventId,
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

function createSuffix(label: string): string {
  return `integration_new_webhook_${label}`;
}
