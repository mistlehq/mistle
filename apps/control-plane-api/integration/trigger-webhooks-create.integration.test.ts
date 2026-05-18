/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { TriggerKinds } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { TriggerWebhookSchema } from "../src/trigger-webhooks/schemas.js";
import {
  createWebhookTriggerRequestBody,
  GitHubIssueCommentCreatedEventType,
  seedTriggerWebhookTargets,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("trigger webhooks create integration", () => {
  it("creates a webhook trigger in the authenticated user's active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-create@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_create",
      webhookSourceId: "iws_trigger_webhook_create",
      profileId: "sbp_trigger_webhook_create",
      profileVersion: 3,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookTriggerRequestBody({
          name: "GitHub Issue Comments",
          integrationWebhookSourceId: "iws_trigger_webhook_create",
          sandboxProfileId: "sbp_trigger_webhook_create",
          sandboxProfileVersion: 3,
        }),
      ),
    });

    expect(response.status).toBe(201);
    const body = TriggerWebhookSchema.parse(await response.json());
    expect(body.kind).toBe("webhook");
    expect(body.name).toBe("GitHub Issue Comments");
    expect(body.enabled).toBe(true);
    expect(body.integrationWebhookSourceId).toBe("iws_trigger_webhook_create");
    expect(body.eventTypes).toEqual([GitHubIssueCommentCreatedEventType]);
    expect(body.payloadFilter).toEqual({
      [GitHubIssueCommentCreatedEventType]: {
        op: "eq",
        path: ["action"],
        value: "created",
      },
    });
    expect(body.target.sandboxProfileId).toBe("sbp_trigger_webhook_create");
    expect(body.target.sandboxProfileVersion).toBe(3);
    expect(body.target.primaryRepositoryId).toBeNull();

    const persistedTrigger = await env.controlPlaneDb.query.triggers.findFirst({
      where: (table, { eq }) => eq(table.id, body.id),
    });
    if (persistedTrigger === undefined) {
      throw new Error("Expected created trigger to be persisted.");
    }
    expect(persistedTrigger.organizationId).toBe(session.organizationId);
    expect(persistedTrigger.kind).toBe(TriggerKinds.WEBHOOK);

    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, body.id),
    });
    if (persistedWebhook === undefined) {
      throw new Error("Expected created webhook trigger config to be persisted.");
    }
    expect(persistedWebhook.integrationWebhookSourceId).toBe("iws_trigger_webhook_create");
    expect(persistedWebhook.instructions).toBe("Prefer concise triage summaries.");

    const persistedTarget = await env.controlPlaneDb.query.triggerTargets.findFirst({
      where: (table, { eq }) => eq(table.triggerId, body.id),
    });
    if (persistedTarget === undefined) {
      throw new Error("Expected created trigger target to be persisted.");
    }
    expect(persistedTarget.sandboxProfileId).toBe("sbp_trigger_webhook_create");
    expect(persistedTarget.sandboxProfileVersion).toBe(3);
    expect(persistedTarget.primaryRepositoryId).toBeNull();
  });

  it("uses the active sandbox profile version when the request omits a target version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-create-active-version@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_create_active",
      webhookSourceId: "iws_trigger_webhook_create_active",
      profileId: "sbp_trigger_webhook_create_active",
      profileVersion: 2,
      profileActiveVersion: 2,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_trigger_webhook_create_active",
      version: 5,
      state: "draft",
      publishedAt: null,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookTriggerRequestBody({
          name: "GitHub Issue Comments Active",
          integrationWebhookSourceId: "iws_trigger_webhook_create_active",
          sandboxProfileId: "sbp_trigger_webhook_create_active",
        }),
      ),
    });

    expect(response.status).toBe(201);
    const body = TriggerWebhookSchema.parse(await response.json());
    expect(body.target.sandboxProfileVersion).toBe(2);
  });

  it("persists the selected primary repository when the profile binding exposes it", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-create-primary-repository@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_create_primary_repo",
      webhookSourceId: "iws_trigger_webhook_create_primary_repo",
      profileId: "sbp_trigger_webhook_create_primary_repo",
      profileVersion: 3,
      bindingRepositories: ["mistlehq/mistle", "mistlehq/platform"],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookTriggerRequestBody({
          name: "GitHub repo scoped triage",
          integrationWebhookSourceId: "iws_trigger_webhook_create_primary_repo",
          sandboxProfileId: "sbp_trigger_webhook_create_primary_repo",
          sandboxProfileVersion: 3,
          primaryRepositoryId: "mistlehq/platform",
        }),
      ),
    });

    expect(response.status).toBe(201);
    const body = TriggerWebhookSchema.parse(await response.json());
    expect(body.target.primaryRepositoryId).toBe("mistlehq/platform");

    const persistedTarget = await env.controlPlaneDb.query.triggerTargets.findFirst({
      where: (table, { eq }) => eq(table.triggerId, body.id),
    });
    if (persistedTarget === undefined) {
      throw new Error("Expected trigger target row to exist.");
    }
    expect(persistedTarget.primaryRepositoryId).toBe("mistlehq/platform");
  });
});
