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
  GitHubIssueAndPullRequestWebhookSourceProviderMetadata,
  GitHubIssueCommentCreatedEventType,
  GitHubPullRequestOpenedEventType,
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

  it("rejects invalid condition payload filters on create", async ({ env }) => {
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
        eventConditions: [
          {
            eventType: GitHubIssueCommentCreatedEventType,
            payloadFilter: {
              op: "not_a_real_operator",
              path: ["action"],
              value: "created",
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    const body = ValidationErrorResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("Invalid eventConditions payloadFilter");
  });

  it("rejects invalid actor policies on create", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-actor-policy-create@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_actor_policy_create",
      webhookSourceId: "iws_trigger_webhook_invalid_actor_policy_create",
      profileId: "sbp_trigger_webhook_invalid_actor_policy_create",
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
          name: "Invalid actor policy",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_actor_policy_create",
          sandboxProfileId: "sbp_trigger_webhook_invalid_actor_policy_create",
          sandboxProfileVersion: 1,
        }),
        eventConditions: [
          {
            eventType: GitHubIssueCommentCreatedEventType,
            actorPolicy: {
              anyOf: [],
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects input template payload references that selected events do not declare on create", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-template-create@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_template_create",
      webhookSourceId: "iws_trigger_webhook_invalid_template_create",
      profileId: "sbp_trigger_webhook_invalid_template_create",
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
          name: "Invalid input template",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_template_create",
          sandboxProfileId: "sbp_trigger_webhook_invalid_template_create",
          sandboxProfileVersion: 1,
        }),
        inputTemplate: "Handle {{payload.comment.missing_field}}",
      }),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("payload.comment.missing_field");
  });

  it("rejects unknown Mistle-owned webhook event references on create", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-webhook-event-template@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_webhook_event_template",
      webhookSourceId: "iws_trigger_webhook_invalid_webhook_event_template",
      profileId: "sbp_trigger_webhook_invalid_webhook_event_template",
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
          name: "Invalid webhook event template",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_webhook_event_template",
          sandboxProfileId: "sbp_trigger_webhook_invalid_webhook_event_template",
          sandboxProfileVersion: 1,
        }),
        inputTemplate: "Payload {{payload}} delivery {{webhookEvent.externalDeliveryID}}",
      }),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("webhookEvent.externalDeliveryID");
  });

  it("allows input template payload references declared by any selected event on create", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-any-selected-template@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_any_selected_template",
      webhookSourceId: "iws_trigger_webhook_any_selected_template",
      profileId: "sbp_trigger_webhook_any_selected_template",
      profileVersion: 1,
      providerMetadata: GitHubIssueAndPullRequestWebhookSourceProviderMetadata,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/triggers/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        ...createWebhookTriggerRequestBody({
          name: "Any selected event input template",
          integrationWebhookSourceId: "iws_trigger_webhook_any_selected_template",
          sandboxProfileId: "sbp_trigger_webhook_any_selected_template",
          sandboxProfileVersion: 1,
        }),
        eventConditions: [
          {
            eventType: GitHubIssueCommentCreatedEventType,
          },
          {
            eventType: GitHubPullRequestOpenedEventType,
          },
        ],
        inputTemplate:
          "{% if payload.pull_request.number %}Pull request {{payload.pull_request.number}} from {{payload.pull_request.head.ref}} into {{payload.pull_request.base.ref}}{% endif %}\nIssue {{payload.comment.body}}",
      }),
    });

    expect(response.status).toBe(201);
  });

  it("rejects invalid Liquid syntax in input templates on create", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-template-syntax-create@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_template_syntax_create",
      webhookSourceId: "iws_trigger_webhook_invalid_template_syntax_create",
      profileId: "sbp_trigger_webhook_invalid_template_syntax_create",
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
          name: "Invalid input template syntax",
          integrationWebhookSourceId: "iws_trigger_webhook_invalid_template_syntax_create",
          sandboxProfileId: "sbp_trigger_webhook_invalid_template_syntax_create",
          sandboxProfileVersion: 1,
        }),
        inputTemplate: "Handle {{payload.comment.body",
      }),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("Invalid inputTemplate Liquid syntax");
  });

  it("rejects actor attribute policies on create", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-actor-attribute-create@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_actor_attribute_create",
      webhookSourceId: "iws_trigger_webhook_actor_attribute_create",
      profileId: "sbp_trigger_webhook_actor_attribute_create",
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
          name: "Actor attribute",
          integrationWebhookSourceId: "iws_trigger_webhook_actor_attribute_create",
          sandboxProfileId: "sbp_trigger_webhook_actor_attribute_create",
          sandboxProfileVersion: 1,
        }),
        eventConditions: [
          {
            eventType: GitHubIssueCommentCreatedEventType,
            actorPolicy: {
              anyOf: [
                {
                  kind: "attribute",
                  attributeKey: "is_bot",
                  attributeValue: "maybe",
                  valueType: "boolean",
                },
              ],
            },
          },
        ],
      }),
    });

    expect(response.status).toBe(400);
    const body = CreateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid condition payload filters on update", async ({ env }) => {
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
          eventConditions: [
            {
              eventType: GitHubIssueCommentCreatedEventType,
              payloadFilter: {
                op: "not_a_real_operator",
                path: ["action"],
                value: "opened",
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = UpdateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("Invalid eventConditions payloadFilter");
  });

  it("rejects input template payload references that selected events do not declare on update", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-template-update@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_template_update",
      webhookSourceId: "iws_trigger_webhook_invalid_template_update",
      profileId: "sbp_trigger_webhook_invalid_template_update",
      profileVersion: 2,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_invalid_template_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_invalid_template_update",
      profileId: "sbp_trigger_webhook_invalid_template_update",
      profileVersion: 2,
      targetId: "atg_trigger_webhook_invalid_template_update",
      name: "Needs valid input template update",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_invalid_template_update",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          inputTemplate: "Handle {{payload.comment.missing_field}}",
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = UpdateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.message).toContain("payload.comment.missing_field");
  });

  it("allows unrelated updates when an existing input template has undeclared payload references", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-legacy-invalid-template-update@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_legacy_invalid_template_update",
      webhookSourceId: "iws_trigger_webhook_legacy_invalid_template_update",
      profileId: "sbp_trigger_webhook_legacy_invalid_template_update",
      profileVersion: 2,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_legacy_invalid_template_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_legacy_invalid_template_update",
      profileId: "sbp_trigger_webhook_legacy_invalid_template_update",
      profileVersion: 2,
      targetId: "atg_trigger_webhook_legacy_invalid_template_update",
      name: "Legacy invalid input template",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.webhookTriggers)
      .set({
        inputTemplate: "Handle {{payload.comment.missing_field}}",
      })
      .where(
        eq(
          env.controlPlaneTables.webhookTriggers.triggerId,
          "atm_trigger_webhook_legacy_invalid_template_update",
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_legacy_invalid_template_update",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Renamed legacy invalid input template",
        }),
      },
    );

    expect(response.status).toBe(200);
    const persistedTrigger = await env.controlPlaneDb.query.triggers.findFirst({
      columns: {
        name: true,
      },
      where: (table, { eq }) => eq(table.id, "atm_trigger_webhook_legacy_invalid_template_update"),
    });
    expect(persistedTrigger?.name).toBe("Renamed legacy invalid input template");
  });

  it("rejects ambiguous actor resource references on update", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-invalid-actor-policy-update@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_invalid_actor_policy_update",
      webhookSourceId: "iws_trigger_webhook_invalid_actor_policy_update",
      profileId: "sbp_trigger_webhook_invalid_actor_policy_update",
      profileVersion: 2,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_invalid_actor_policy_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_invalid_actor_policy_update",
      profileId: "sbp_trigger_webhook_invalid_actor_policy_update",
      profileVersion: 2,
      targetId: "atg_trigger_webhook_invalid_actor_policy_update",
      name: "Needs valid actor policy update",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_invalid_actor_policy_update",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          eventConditions: [
            {
              eventType: GitHubIssueCommentCreatedEventType,
              actorPolicy: {
                anyOf: [
                  {
                    kind: "resource",
                    actor: {
                      resourceKind: "user",
                      externalId: "U123",
                      handle: "octocat",
                    },
                  },
                ],
              },
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = UpdateTriggerWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});
