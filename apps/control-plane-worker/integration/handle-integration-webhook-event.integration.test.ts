/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  TriggerKinds,
  TriggerRunStatuses,
  TriggerConversationCreatedByKinds,
  TriggerConversationOwnerKinds,
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  IntegrationConnectionResourceSyncStates,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  IntegrationWebhookEventStatuses,
  ProviderResourceAssociationDeliveryProcessorStatuses,
  ProviderResourceAssociationDeliveryStatuses,
} from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  SlackThreadMessageModes,
} from "@mistle/integrations-core";
import {
  createIntegrationRegistry,
  OpenAiApiKeyDefinition,
} from "@mistle/integrations-definitions/server";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { prepareIntegrationWebhookEvent } from "../openworkflow/handle-integration-webhook-event/prepare-integration-webhook-event.js";

const it = createIntegrationTest({
  services: ["control-plane-worker", "control-plane-api", "data-plane-api"],
});

const InternalServiceToken = "integration-new-internal-service-token";
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
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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

  it("queues trigger runs and provider resource association deliveries for the same webhook event", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_delivery"),
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
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 42,
          pull_request: {},
        },
        comment: {
          body: "please run @mistlebot",
        },
        sender: {
          login: "octocat",
        },
      },
      externalEventId: "evt_association_delivery",
      externalDeliveryId: "delivery_association_delivery",
    });
    const sandboxInstanceId = "sbi_association_delivery";
    const associationId = "pra_association_delivery";
    const staleAssociationId = "pra_association_delivery_stale";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#42",
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: staleAssociationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#99",
      sandboxInstanceId: "sbi_missing_association_delivery",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
    });
    expect(preparedEvent.triggerRunIds).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
    });

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toHaveLength(1);
    expect(queuedDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
      sourceWebhookEventId: scope.webhookEventId,
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
      renderedInput: [
        "Repository: mistlehq/mistle",
        "Event type: github.issue_comment.created",
        "Author: octocat",
        "",
        "Pull request issue comment:",
        "PR #42",
        "Comment body: please run @mistlebot",
      ].join("\n"),
    });

    const processor =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveryProcessors.findFirst({
        where: (table, { eq }) => eq(table.providerResourceAssociationId, associationId),
      });
    expect(processor).toMatchObject({
      providerResourceAssociationId: associationId,
      status: ProviderResourceAssociationDeliveryProcessorStatuses.IDLE,
    });

    const retriedPreparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );
    expect(retriedPreparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
      finalized: false,
    });
    expect(retriedPreparedEvent.triggerRunIds).toEqual(preparedEvent.triggerRunIds);
    expect(retriedPreparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);
    expect(retriedPreparedEvent.providerResourceAssociationDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
    });
  });

  it("queues provider resource association deliveries for threaded Slack app mentions", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("slack_association_delivery"),
      familyId: "slack",
      variantId: "slack-default",
      targetConfig: {},
      connectionConfig: {
        bot_user_id: "U_BOT_SLACK_ASSOCIATION",
      },
      eventType: "slack:app_mention",
      providerEventType: "app_mention",
      payload: {
        event: {
          channel: "C123",
          mistle_thread_root_ts: "1710000000.000100",
          text: "Can you follow up here?",
          thread_ts: "1710000000.000100",
          ts: "1710000001.000200",
          user: "U_HUMAN_SLACK_ASSOCIATION",
        },
      },
      externalEventId: "evt_slack_association_delivery",
      externalDeliveryId: "delivery_slack_association_delivery",
      createTrigger: false,
    });
    const sandboxInstanceId = "sbi_slack_association_delivery";
    const associationId = "pra_slack_association_delivery";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
      associatedResourceEventRouting: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
            eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
            messageMode: SlackThreadMessageModes.APP_MENTIONS_ONLY,
          },
        ],
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      providerResourceId: "C123:1710000000.000100",
      sandboxInstanceId,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
      triggerRunIds: [],
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
    });

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toHaveLength(1);
    expect(queuedDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
      sourceWebhookEventId: scope.webhookEventId,
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
      renderedInput: [
        "Slack channel: C123",
        "Thread root: 1710000000.000100",
        "Event type: slack.thread.message.created",
        "Author: U_HUMAN_SLACK_ASSOCIATION",
        "",
        "Thread reply:",
        "Message text: Can you follow up here?",
      ].join("\n"),
    });
  });

  it("does not queue provider resource association deliveries for top-level Slack app mentions", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("slack_association_top_level_app_mention"),
      familyId: "slack",
      variantId: "slack-default",
      targetConfig: {},
      connectionConfig: {
        bot_user_id: "U_BOT_SLACK_ASSOCIATION_TOP_LEVEL",
      },
      eventType: "slack:app_mention",
      providerEventType: "app_mention",
      payload: {
        event: {
          channel: "C123",
          mistle_thread_root_ts: "1710000000.000100",
          text: "Can you start something new?",
          thread_ts: "1710000000.000100",
          ts: "1710000000.000100",
          user: "U_HUMAN_SLACK_ASSOCIATION_TOP_LEVEL",
        },
      },
      externalEventId: "evt_slack_association_top_level_app_mention",
      externalDeliveryId: "delivery_slack_association_top_level_app_mention",
      createTrigger: false,
    });
    const sandboxInstanceId = "sbi_slack_association_top_level_app_mention";
    const associationId = "pra_slack_association_top_level_app_mention";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
      associatedResourceEventRouting: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
            eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
          },
        ],
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      providerResourceId: "C123:1710000000.000100",
      sandboxInstanceId,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
      finalized: true,
      triggerRunIds: [],
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toEqual([]);

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toEqual([]);
  });

  it("does not queue ordinary Slack thread messages when Slack routing only receives app mentions", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("slack_association_app_mentions_only_excludes_message"),
      familyId: "slack",
      variantId: "slack-default",
      targetConfig: {},
      connectionConfig: {
        bot_user_id: "U_BOT_SLACK_ASSOCIATION_APP_MENTIONS_ONLY",
      },
      eventType: "slack:message",
      providerEventType: "message",
      payload: {
        event: {
          channel: "C123",
          mistle_thread_root_ts: "1710000000.000100",
          text: "Can you follow up here?",
          thread_ts: "1710000000.000100",
          ts: "1710000001.000200",
          user: "U_HUMAN_SLACK_ASSOCIATION_APP_MENTIONS_ONLY",
        },
      },
      externalEventId: "evt_slack_association_app_mentions_only_excludes_message",
      externalDeliveryId: "delivery_slack_association_app_mentions_only_excludes_message",
      createTrigger: false,
    });
    const sandboxInstanceId = "sbi_slack_association_app_mentions_only_excludes_message";
    const associationId = "pra_slack_association_app_mentions_only_excludes_message";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
      associatedResourceEventRouting: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
            eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
            messageMode: SlackThreadMessageModes.APP_MENTIONS_ONLY,
          },
        ],
      },
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
      providerResourceId: "C123:1710000000.000100",
      sandboxInstanceId,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
      finalized: true,
      triggerRunIds: [],
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toEqual([]);

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toEqual([]);
  });

  it("skips trigger runs when association delivery targets the existing trigger conversation sandbox", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_suppresses_trigger"),
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
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 47,
          pull_request: {},
        },
        comment: {
          body: "please run @mistlebot",
        },
        sender: {
          login: "octocat",
        },
      },
      externalEventId: "evt_association_suppresses_trigger",
      externalDeliveryId: "delivery_association_suppresses_trigger",
    });
    const sandboxInstanceId = "sbi_association_suppresses_trigger";
    const associationId = "pra_association_suppresses_trigger";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#47",
      sandboxInstanceId,
    });
    await seedTriggerConversationRoute({
      env,
      conversationId: "cnv_association_suppresses_trigger",
      organizationId: scope.organizationId,
      sandboxInstanceId,
      sandboxProfileId: scope.sandboxProfileId,
      triggerTargetId: scope.triggerTargetId,
      conversationKey: "github/12345",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
      triggerRunIds: [],
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
      sandboxInstanceId,
    });

    const queuedRuns = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
    });
    expect(queuedRuns).toEqual([]);

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toHaveLength(1);
    expect(queuedDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
    });
  });

  it("marks preexisting queued trigger runs ignored when retry suppression prefers association delivery", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_suppresses_retry"),
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
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 49,
          pull_request: {},
        },
        comment: {
          body: "please run @mistlebot",
        },
        sender: {
          login: "octocat",
        },
      },
      externalEventId: "evt_association_suppresses_retry",
      externalDeliveryId: "delivery_association_suppresses_retry",
    });
    const triggerRunId = "trn_association_suppresses_retry";
    const sandboxInstanceId = "sbi_association_suppresses_retry";
    const associationId = "pra_association_suppresses_retry";

    await env.controlPlaneDb.insert(env.controlPlaneTables.triggerRuns).values({
      id: triggerRunId,
      triggerId: scope.triggerId,
      triggerTargetId: scope.triggerTargetId,
      sourceWebhookEventId: scope.webhookEventId,
      status: TriggerRunStatuses.QUEUED,
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.integrationWebhookEvents)
      .set({
        status: IntegrationWebhookEventStatuses.PROCESSING,
      })
      .where(eq(env.controlPlaneTables.integrationWebhookEvents.id, scope.webhookEventId));
    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#49",
      sandboxInstanceId,
    });
    await seedTriggerConversationRoute({
      env,
      conversationId: "cnv_association_suppresses_retry",
      organizationId: scope.organizationId,
      sandboxInstanceId,
      sandboxProfileId: scope.sandboxProfileId,
      triggerTargetId: scope.triggerTargetId,
      conversationKey: "github/12345",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
      triggerRunIds: [],
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);

    const persistedRun = await env.controlPlaneDb.query.triggerRuns.findFirst({
      where: (table, { eq }) => eq(table.id, triggerRunId),
    });
    expect(persistedRun).toMatchObject({
      id: triggerRunId,
      status: TriggerRunStatuses.IGNORED,
      failureCode: "association_delivery_preferred",
    });
    expect(persistedRun?.finishedAt).not.toBeNull();
  });

  it("queues trigger runs when suppression cannot render the trigger conversation key", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_malformed_trigger_key"),
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
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 48,
          pull_request: {},
        },
        comment: {
          body: "please run @mistlebot",
        },
        sender: {
          login: "octocat",
        },
      },
      externalEventId: "evt_association_malformed_trigger_key",
      externalDeliveryId: "delivery_association_malformed_trigger_key",
    });
    const sandboxInstanceId = "sbi_association_malformed_trigger_key";
    const associationId = "pra_association_malformed_trigger_key";

    await env.controlPlaneDb
      .update(env.controlPlaneTables.webhookTriggers)
      .set({
        conversationKeyTemplate: "github/{{payload.missing.required}}",
      })
      .where(eq(env.controlPlaneTables.webhookTriggers.triggerId, scope.triggerId));
    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#48",
      sandboxInstanceId,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
      sandboxInstanceId,
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

  it("queues trigger runs without provider resource association deliveries for self-authored app events", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_self_authored"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {
        connection_method: "github-app-installation",
        app_id: "12345",
        app_slug: "mistle-github-app",
        client_id: "Iv1.example",
        installation_id: "98765",
      },
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
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 45,
          pull_request: {},
        },
        comment: {
          body: "finished this @mistlebot",
        },
        sender: {
          login: "mistle-github-app[bot]",
        },
      },
      externalEventId: "evt_association_self_authored",
      externalDeliveryId: "delivery_association_self_authored",
    });
    const sandboxInstanceId = "sbi_association_self_authored";
    const associationId = "pra_association_self_authored";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#45",
      sandboxInstanceId,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
    });
    expect(preparedEvent.triggerRunIds).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries).toEqual([]);

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toEqual([]);
  });

  it("marks self-authored app events ignored when suppression leaves no queued work", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_self_authored_ignored"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {
        connection_method: "github-app-installation",
        app_id: "12345",
        app_slug: "mistle-github-app",
        client_id: "Iv1.example",
        installation_id: "98765",
      },
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      createTrigger: false,
      payload: {
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 46,
          pull_request: {},
        },
        comment: {
          body: "finished this",
        },
        sender: {
          login: "mistle-github-app[bot]",
        },
      },
      externalEventId: "evt_association_self_authored_ignored",
      externalDeliveryId: "delivery_association_self_authored_ignored",
    });
    const sandboxInstanceId = "sbi_association_self_authored_ignored";
    const associationId = "pra_association_self_authored_ignored";

    await seedSandboxInstance({
      env,
      organizationId: scope.organizationId,
      sandboxProfileId: scope.sandboxProfileId,
      sandboxProfileVersion: scope.sandboxProfileVersion,
      sandboxInstanceId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#46",
      sandboxInstanceId,
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toEqual({
      webhookEventId: scope.webhookEventId,
      externalDeliveryId: "delivery_association_self_authored_ignored",
      integrationConnectionId: scope.connectionId,
      targetKey: scope.targetKey,
      webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
      triggerRunIds: [],
      providerResourceAssociationDeliveries: [],
      resourceSyncRequests: [],
      finalized: true,
    });

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toEqual([]);

    const queuedRuns = await env.controlPlaneDb.query.triggerRuns.findMany({
      where: (table, { eq }) => eq(table.sourceWebhookEventId, scope.webhookEventId),
    });
    expect(queuedRuns).toEqual([]);
  });

  it("queues provider resource association deliveries when the associated sandbox is missing", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("association_missing_sandbox"),
      familyId: "github",
      variantId: "github-cloud",
      targetConfig: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      connectionConfig: {},
      eventType: "github.issue_comment.created",
      providerEventType: "issue_comment",
      createTrigger: false,
      payload: {
        repository: {
          full_name: "mistlehq/mistle",
        },
        issue: {
          number: 43,
          pull_request: {},
        },
        comment: {
          body: "please run @mistlebot",
        },
        sender: {
          login: "octocat",
        },
      },
      externalEventId: "evt_association_missing_sandbox",
      externalDeliveryId: "delivery_association_missing_sandbox",
    });
    const associationId = "pra_association_missing_sandbox";

    await env.controlPlaneDb.insert(env.controlPlaneTables.providerResourceAssociations).values({
      id: associationId,
      integrationConnectionId: scope.connectionId,
      resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
      providerResourceId: "mistlehq/mistle#43",
      sandboxInstanceId: "sbi_missing_association_delivery",
    });

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      finalized: false,
      triggerRunIds: [],
    });
    expect(preparedEvent.providerResourceAssociationDeliveries).toHaveLength(1);
    expect(preparedEvent.providerResourceAssociationDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
    });

    const queuedDeliveries =
      await env.controlPlaneDb.query.providerResourceAssociationDeliveries.findMany({
        where: (table, { eq: whereEq }) =>
          whereEq(table.sourceWebhookEventId, scope.webhookEventId),
      });
    expect(queuedDeliveries).toHaveLength(1);
    expect(queuedDeliveries[0]).toMatchObject({
      providerResourceAssociationId: associationId,
      sourceWebhookEventId: scope.webhookEventId,
      sourceOrderKey: "2026-03-09T00:00:00Z#0001",
      status: ProviderResourceAssociationDeliveryStatuses.QUEUED,
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
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
      providerResourceAssociationDeliveries: [],
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

  it("marks retried processing webhook events ignored when no trigger targets or sync triggers match", async ({
    env,
  }) => {
    const scope = await seedWebhookEventScope({
      env,
      suffix: createSuffix("ignore_retry"),
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
      externalEventId: "evt_ignore_retry",
      externalDeliveryId: "delivery_ignore_retry",
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.integrationWebhookEvents)
      .set({
        status: IntegrationWebhookEventStatuses.PROCESSING,
      })
      .where(eq(env.controlPlaneTables.integrationWebhookEvents.id, scope.webhookEventId));

    const preparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );

    expect(preparedEvent).toEqual({
      webhookEventId: scope.webhookEventId,
      externalDeliveryId: "delivery_ignore_retry",
      integrationConnectionId: scope.connectionId,
      targetKey: scope.targetKey,
      webhookEventStatus: IntegrationWebhookEventStatuses.IGNORED,
      triggerRunIds: [],
      providerResourceAssociationDeliveries: [],
      resourceSyncRequests: [],
      finalized: true,
    });

    const persistedEvent = await env.controlPlaneDb.query.integrationWebhookEvents.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, scope.webhookEventId),
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
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
    const resourceSyncKinds: readonly ["repository", "user"] = ["repository", "user"];
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
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
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
    expect(preparedEvent.resourceSyncRequests).toEqual(
      resourceSyncKinds.map((kind) => ({
        organizationId: scope.organizationId,
        connectionId: scope.connectionId,
        kind,
      })),
    );

    const retriedPreparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );
    expect(retriedPreparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
      triggerRunIds: [],
      finalized: false,
    });
    expect(retriedPreparedEvent.resourceSyncRequests).toEqual(preparedEvent.resourceSyncRequests);

    const webhookEvent = await env.controlPlaneDb.query.integrationWebhookEvents.findFirst({
      columns: {
        sourceOccurredAt: true,
      },
      where: (table, { eq }) => eq(table.id, scope.webhookEventId),
    });
    if (webhookEvent === undefined) {
      throw new Error("Expected webhook event to exist after resource sync preparation.");
    }
    if (webhookEvent.sourceOccurredAt === null) {
      throw new Error("Expected webhook event to include sourceOccurredAt.");
    }
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.integrationConnectionResourceStates)
      .values(
        resourceSyncKinds.map((kind) => ({
          connectionId: scope.connectionId,
          familyId: "github",
          kind,
          syncState: IntegrationConnectionResourceSyncStates.SYNCING,
          lastSyncStartedAt: webhookEvent.sourceOccurredAt,
        })),
      );

    const scheduledRetryPreparedEvent = await prepareIntegrationWebhookEvent(
      {
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
        db: env.controlPlaneDb,
        integrationRegistry: createIntegrationRegistry(),
      },
      {
        webhookEventId: scope.webhookEventId,
      },
    );
    expect(scheduledRetryPreparedEvent).toMatchObject({
      webhookEventId: scope.webhookEventId,
      webhookEventStatus: IntegrationWebhookEventStatuses.PROCESSING,
      triggerRunIds: [],
      finalized: false,
    });
    expect(scheduledRetryPreparedEvent.resourceSyncRequests).toEqual([]);
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
  sandboxProfileVersion: number;
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
  const sandboxProfileVersion = 2;
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
      sandboxProfileVersion,
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
      sandboxProfileVersion,
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
    sandboxProfileVersion,
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

async function seedSandboxInstance(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  sandboxInstanceId: string;
  associatedResourceEventRouting?: CompiledRuntimePlan["associatedResourceEventRouting"];
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_association_delivery",
    source: "webhook",
  });

  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstanceRuntimePlans).values({
    sandboxInstanceId: input.sandboxInstanceId,
    revision: 1,
    compiledRuntimePlan: createRuntimePlan({
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      ...(input.associatedResourceEventRouting === undefined
        ? {}
        : { associatedResourceEventRouting: input.associatedResourceEventRouting }),
    }),
    compiledFromProfileId: input.sandboxProfileId,
    compiledFromProfileVersion: input.sandboxProfileVersion,
  });
}

async function seedTriggerConversationRoute(input: {
  env: IntegrationTestEnvironment;
  conversationId: string;
  organizationId: string;
  sandboxInstanceId: string;
  sandboxProfileId: string;
  triggerTargetId: string;
  conversationKey: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerConversations).values({
    id: input.conversationId,
    organizationId: input.organizationId,
    ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
    ownerId: input.triggerTargetId,
    createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
    createdById: "iwe_existing_route",
    sandboxProfileId: input.sandboxProfileId,
    integrationFamilyId: "github",
    runtimeId: "codex",
    conversationKey: input.conversationKey,
    status: TriggerConversationStatuses.ACTIVE,
  });
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.triggerConversationRoutes)
    .values({
      conversationId: input.conversationId,
      sandboxInstanceId: input.sandboxInstanceId,
      providerConversationId: "thread_existing_route",
      providerExecutionId: null,
      providerState: null,
      status: TriggerConversationRouteStatuses.ACTIVE,
    });
}

function createRuntimePlan(input: {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  associatedResourceEventRouting?: CompiledRuntimePlan["associatedResourceEventRouting"];
}): CompiledRuntimePlan {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.sandboxProfileVersion,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    associatedResourceEventRouting: input.associatedResourceEventRouting ?? {
      enabled: true,
      resources: [
        {
          resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
          eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
        },
      ],
    },
    runtimeClients: [],
    agentRuntimes: [],
  };
}

function createControlPlaneInternalClient(
  env: IntegrationTestEnvironment,
): ControlPlaneInternalClient {
  return new ControlPlaneInternalClient({
    baseUrl: env.controlPlaneApi.hostBaseUrl,
    internalAuthServiceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createSuffix(label: string): string {
  return `integration_new_webhook_${label}`;
}
