/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { AutomationKinds } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { AutomationWebhookSchema } from "../src/automation-webhooks/schemas.js";
import {
  createWebhookAutomationRequestBody,
  GitHubIssueCommentCreatedEventType,
  seedAutomationWebhookTargets,
  seedWebhookAutomationFixture,
} from "./helpers/automation-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("automation webhooks create integration", () => {
  it("creates a webhook automation in the authenticated user's active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-create@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_create",
      webhookSourceId: "iws_automation_webhook_create",
      profileId: "sbp_automation_webhook_create",
      profileVersion: 3,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookAutomationRequestBody({
          name: "GitHub Issue Comments",
          integrationWebhookSourceId: "iws_automation_webhook_create",
          sandboxProfileId: "sbp_automation_webhook_create",
          sandboxProfileVersion: 3,
        }),
      ),
    });

    expect(response.status).toBe(201);
    const body = AutomationWebhookSchema.parse(await response.json());
    expect(body.kind).toBe("webhook");
    expect(body.name).toBe("GitHub Issue Comments");
    expect(body.enabled).toBe(true);
    expect(body.integrationWebhookSourceId).toBe("iws_automation_webhook_create");
    expect(body.eventTypes).toEqual([GitHubIssueCommentCreatedEventType]);
    expect(body.payloadFilter).toEqual({
      [GitHubIssueCommentCreatedEventType]: {
        op: "eq",
        path: ["action"],
        value: "created",
      },
    });
    expect(body.target.sandboxProfileId).toBe("sbp_automation_webhook_create");
    expect(body.target.sandboxProfileVersion).toBe(3);
    expect(body.target.primaryRepositoryId).toBeNull();

    const persistedAutomation = await env.controlPlaneDb.query.automations.findFirst({
      where: (table, { eq }) => eq(table.id, body.id),
    });
    if (persistedAutomation === undefined) {
      throw new Error("Expected created automation to be persisted.");
    }
    expect(persistedAutomation.organizationId).toBe(session.organizationId);
    expect(persistedAutomation.kind).toBe(AutomationKinds.WEBHOOK);

    const persistedWebhook = await env.controlPlaneDb.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, body.id),
    });
    if (persistedWebhook === undefined) {
      throw new Error("Expected created webhook automation config to be persisted.");
    }
    expect(persistedWebhook.integrationWebhookSourceId).toBe("iws_automation_webhook_create");
    expect(persistedWebhook.instructions).toBe("Prefer concise triage summaries.");

    const persistedTarget = await env.controlPlaneDb.query.automationTargets.findFirst({
      where: (table, { eq }) => eq(table.automationId, body.id),
    });
    if (persistedTarget === undefined) {
      throw new Error("Expected created automation target to be persisted.");
    }
    expect(persistedTarget.sandboxProfileId).toBe("sbp_automation_webhook_create");
    expect(persistedTarget.sandboxProfileVersion).toBe(3);
    expect(persistedTarget.primaryRepositoryId).toBeNull();
  });

  it("uses the active sandbox profile version when the request omits a target version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-create-active-version@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_create_active",
      webhookSourceId: "iws_automation_webhook_create_active",
      profileId: "sbp_automation_webhook_create_active",
      profileVersion: 2,
      profileActiveVersion: 2,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      sandboxProfileId: "sbp_automation_webhook_create_active",
      version: 5,
      state: "draft",
      publishedAt: null,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookAutomationRequestBody({
          name: "GitHub Issue Comments Active",
          integrationWebhookSourceId: "iws_automation_webhook_create_active",
          sandboxProfileId: "sbp_automation_webhook_create_active",
        }),
      ),
    });

    expect(response.status).toBe(201);
    const body = AutomationWebhookSchema.parse(await response.json());
    expect(body.target.sandboxProfileVersion).toBe(2);
  });

  it("persists the selected primary repository when the profile binding exposes it", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-create-primary-repository@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_create_primary_repo",
      webhookSourceId: "iws_automation_webhook_create_primary_repo",
      profileId: "sbp_automation_webhook_create_primary_repo",
      profileVersion: 3,
      bindingRepositories: ["mistlehq/mistle", "mistlehq/platform"],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookAutomationRequestBody({
          name: "GitHub repo scoped triage",
          integrationWebhookSourceId: "iws_automation_webhook_create_primary_repo",
          sandboxProfileId: "sbp_automation_webhook_create_primary_repo",
          sandboxProfileVersion: 3,
          primaryRepositoryId: "mistlehq/platform",
        }),
      ),
    });

    expect(response.status).toBe(201);
    const body = AutomationWebhookSchema.parse(await response.json());
    expect(body.target.primaryRepositoryId).toBe("mistlehq/platform");

    const persistedTarget = await env.controlPlaneDb.query.automationTargets.findFirst({
      where: (table, { eq }) => eq(table.automationId, body.id),
    });
    if (persistedTarget === undefined) {
      throw new Error("Expected automation target row to exist.");
    }
    expect(persistedTarget.primaryRepositoryId).toBe("mistlehq/platform");
  });
});
