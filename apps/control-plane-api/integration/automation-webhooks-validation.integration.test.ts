/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { CreateAutomationWebhookBadRequestResponseSchema } from "../src/automation-webhooks/create-automation-webhook/index.js";
import { UpdateAutomationWebhookBadRequestResponseSchema } from "../src/automation-webhooks/update-automation-webhook/index.js";
import {
  createWebhookAutomationRequestBody,
  GitHubIssueCommentCreatedEventType,
  OpenAiAutomationTargetKey,
  seedAutomationWebhookTargets,
  seedPersistedWebhookAutomation,
  seedWebhookAutomationFixture,
} from "./helpers/automation-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("automation webhooks validation integration", () => {
  it("rejects webhook automation creation for a non-webhook-capable target", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-invalid-target@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_invalid_target",
      webhookSourceId: "iws_automation_webhook_invalid_target",
      profileId: "sbp_automation_webhook_invalid_target",
      targetKey: OpenAiAutomationTargetKey,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookAutomationRequestBody({
          name: "Invalid target",
          integrationWebhookSourceId: "iws_automation_webhook_invalid_target",
          sandboxProfileId: "sbp_automation_webhook_invalid_target",
        }),
      ),
    });

    expect(response.status).toBe(400);
    const body = CreateAutomationWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE");
  });

  it("rejects webhook automation creation when the profile lacks a trigger binding", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-invalid-trigger-binding@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_invalid_trigger",
      webhookSourceId: "iws_automation_webhook_invalid_trigger",
      profileId: "sbp_automation_webhook_invalid_trigger",
      profileVersion: 1,
    });
    await env.controlPlaneDb
      .delete(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .where(
        eq(
          env.controlPlaneTables.sandboxProfileVersionIntegrationBindings.connectionId,
          "icn_automation_webhook_invalid_trigger",
        ),
      );

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookAutomationRequestBody({
          name: "Invalid trigger binding",
          integrationWebhookSourceId: "iws_automation_webhook_invalid_trigger",
          sandboxProfileId: "sbp_automation_webhook_invalid_trigger",
          sandboxProfileVersion: 1,
        }),
      ),
    });

    expect(response.status).toBe(400);
    const body = CreateAutomationWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE");
  });

  it("rejects unavailable primary repository selections", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-invalid-primary-repository@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_invalid_primary_repo",
      webhookSourceId: "iws_automation_webhook_invalid_primary_repo",
      profileId: "sbp_automation_webhook_invalid_primary_repo",
      profileVersion: 1,
      bindingRepositories: ["mistlehq/mistle"],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookAutomationRequestBody({
          name: "Invalid primary repository",
          integrationWebhookSourceId: "iws_automation_webhook_invalid_primary_repo",
          sandboxProfileId: "sbp_automation_webhook_invalid_primary_repo",
          sandboxProfileVersion: 1,
          primaryRepositoryId: "mistlehq/platform",
        }),
      ),
    });

    expect(response.status).toBe(400);
    const body = CreateAutomationWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_PRIMARY_REPOSITORY");
  });

  it("rejects non-event-scoped payload filters on create", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-invalid-filter-create@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_invalid_filter_create",
      webhookSourceId: "iws_automation_webhook_invalid_filter_create",
      profileId: "sbp_automation_webhook_invalid_filter_create",
      profileVersion: 1,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        ...createWebhookAutomationRequestBody({
          name: "Invalid filter",
          integrationWebhookSourceId: "iws_automation_webhook_invalid_filter_create",
          sandboxProfileId: "sbp_automation_webhook_invalid_filter_create",
          sandboxProfileVersion: 1,
        }),
        payloadFilter: {
          op: "eq",
          path: ["action"],
          value: "created",
        },
      }),
    });

    expect(response.status).toBe(400);
    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("Invalid payloadFilter");
  });

  it("rejects payload filters for events outside the selected event set on update", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-invalid-filter-update@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_invalid_filter_update",
      webhookSourceId: "iws_automation_webhook_invalid_filter_update",
      profileId: "sbp_automation_webhook_invalid_filter_update",
      profileVersion: 2,
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automation_webhook_invalid_filter_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_automation_webhook_invalid_filter_update",
      profileId: "sbp_automation_webhook_invalid_filter_update",
      profileVersion: 2,
      targetId: "atg_automation_webhook_invalid_filter_update",
      name: "Needs valid filter update",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/automations/webhooks/atm_automation_webhook_invalid_filter_update",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          eventTypes: [GitHubIssueCommentCreatedEventType],
          payloadFilter: {
            "github.pull_request.opened": {
              op: "eq",
              path: ["action"],
              value: "opened",
            },
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = UpdateAutomationWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("not selected");
  });
});
