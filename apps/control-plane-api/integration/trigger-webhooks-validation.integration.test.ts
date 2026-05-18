/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { CreateTriggerWebhookBadRequestResponseSchema } from "../src/trigger-webhooks/create-trigger-webhook/index.js";
import { UpdateTriggerWebhookBadRequestResponseSchema } from "../src/trigger-webhooks/update-trigger-webhook/index.js";
import {
  createWebhookTriggerRequestBody,
  GitHubIssueCommentCreatedEventType,
  OpenAiTriggerTargetKey,
  seedTriggerWebhookTargets,
  seedPersistedWebhookTrigger,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("trigger webhooks validation integration", () => {
  it("rejects webhook trigger creation for a non-webhook-capable target", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-target@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_target",
      webhookSourceId: "iws_trigger_webhook_invalid_target",
      profileId: "sbp_trigger_webhook_invalid_target",
      targetKey: OpenAiTriggerTargetKey,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookTriggerRequestBody({
          name: "Invalid target",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_target",
          sandboxProfileId: "sbp_trigger_webhook_invalid_target",
        }),
      ),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("WEBHOOK_SOURCE_TARGET_NOT_WEBHOOK_CAPABLE");
  });

  it("rejects webhook trigger creation when the profile lacks a trigger binding", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-trigger-binding@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_trigger",
      webhookSourceId: "iws_trigger_webhook_invalid_trigger",
      profileId: "sbp_trigger_webhook_invalid_trigger",
      profileVersion: 1,
    });
    await env.controlPlaneDb
      .delete(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .where(
        eq(
          env.controlPlaneTables.sandboxProfileVersionIntegrationBindings.connectionId,
          "icn_trigger_webhook_invalid_trigger",
        ),
      );

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookTriggerRequestBody({
          name: "Invalid trigger binding",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_trigger",
          sandboxProfileId: "sbp_trigger_webhook_invalid_trigger",
          sandboxProfileVersion: 1,
        }),
      ),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_SANDBOX_PROFILE_TRIGGER_REFERENCE");
  });

  it("rejects unavailable primary repository selections", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-primary-repository@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_primary_repo",
      webhookSourceId: "iws_trigger_webhook_invalid_primary_repo",
      profileId: "sbp_trigger_webhook_invalid_primary_repo",
      profileVersion: 1,
      bindingRepositories: ["mistlehq/mistle"],
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify(
        createWebhookTriggerRequestBody({
          name: "Invalid primary repository",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_primary_repo",
          sandboxProfileId: "sbp_trigger_webhook_invalid_primary_repo",
          sandboxProfileVersion: 1,
          primaryRepositoryId: "mistlehq/platform",
        }),
      ),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_PRIMARY_REPOSITORY");
  });

  it("rejects non-event-scoped payload filters on create", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-filter-create@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_filter_create",
      webhookSourceId: "iws_trigger_webhook_invalid_filter_create",
      profileId: "sbp_trigger_webhook_invalid_filter_create",
      profileVersion: 1,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        ...createWebhookTriggerRequestBody({
          name: "Invalid filter",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_filter_create",
          sandboxProfileId: "sbp_trigger_webhook_invalid_filter_create",
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
      email: "integration-new-trigger-webhooks-invalid-filter-update@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_filter_update",
      webhookSourceId: "iws_trigger_webhook_invalid_filter_update",
      profileId: "sbp_trigger_webhook_invalid_filter_update",
      profileVersion: 2,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_invalid_filter_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_invalid_filter_update",
      profileId: "sbp_trigger_webhook_invalid_filter_update",
      profileVersion: 2,
      targetId: "atg_trigger_webhook_invalid_filter_update",
      name: "Needs valid filter update",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_invalid_filter_update",
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
    const body = UpdateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("not selected");
  });
});
