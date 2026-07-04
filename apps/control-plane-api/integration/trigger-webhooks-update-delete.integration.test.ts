/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationBindingKinds, type WebhookTriggerActorPolicy } from "@mistle/db/control-plane";
import { NotFoundResponseSchema } from "@mistle/http/errors.js";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { TriggerWebhooksBadRequestCodes } from "../src/trigger-webhooks/constants.js";
import { DeleteTriggerWebhookResponseSchema } from "../src/trigger-webhooks/delete-trigger-webhook/index.js";
import { TriggerWebhookSchema } from "../src/trigger-webhooks/schemas.js";
import {
  seedTriggerWebhookTargets,
  seedPersistedWebhookTrigger,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const SlackWorkspaceActorPolicy: WebhookTriggerActorPolicy = {
  anyOf: [
    {
      kind: "relationship",
      relationshipKind: "belongs_to",
      actorSet: {
        resourceKind: "workspace",
        externalId: "T123",
      },
      scope: {
        resourceKind: "workspace",
        externalId: "T123",
      },
    },
  ],
};

const GitHubTeamActorPolicy: WebhookTriggerActorPolicy = {
  anyOf: [
    {
      kind: "relationship",
      relationshipKind: "belongs_to",
      actorSet: {
        resourceKind: "team",
        externalId: "T_kwDOAAAB",
      },
      scope: {
        resourceKind: "team",
        externalId: "T_kwDOAAAB",
      },
    },
  ],
};

describe.concurrent("trigger webhooks update and delete integration", () => {
  it("gets and updates a webhook trigger while preserving omitted PATCH fields", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-update@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_update_001",
      webhookSourceId: "iws_trigger_webhook_update_001",
      profileId: "sbp_trigger_webhook_update",
      profileVersion: 7,
    });
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_update_002",
      webhookSourceId: "iws_trigger_webhook_update_002",
      profileId: "sbp_trigger_webhook_update_alt",
      profileVersion: 7,
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values({
        sandboxProfileId: "sbp_trigger_webhook_update",
        sandboxProfileVersion: 7,
        connectionId: "icn_trigger_webhook_update_002",
        kind: IntegrationBindingKinds.CONNECTOR,
        config: {},
      });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_update",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_update_001",
      profileId: "sbp_trigger_webhook_update",
      profileVersion: 7,
      targetId: "atg_trigger_webhook_update",
      name: "Before",
      actorPolicy: SlackWorkspaceActorPolicy,
      createdAt: "2026-02-05T00:00:00.000Z",
    });

    const getResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_update",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getResponse.status).toBe(200);
    const getBody = TriggerWebhookSchema.parse(await getResponse.json());
    expect(getBody.name).toBe("Before");
    expect(getBody.integrationWebhookSourceId).toBe("iws_trigger_webhook_update_001");
    expect(getBody.instructions).toBe("Prefer deterministic reproduction steps.");
    expect(getBody.eventConditions[0]?.actorPolicy).toEqual(SlackWorkspaceActorPolicy);
    expect(getBody.target.sandboxProfileVersion).toBe(7);

    const patchResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_update",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "After",
          enabled: false,
          integrationWebhookSourceId: "iws_trigger_webhook_update_002",
          target: {
            sandboxProfileId: "sbp_trigger_webhook_update",
          },
          instructions: null,
          idempotencyKeyTemplate: null,
        }),
      },
    );

    expect(patchResponse.status).toBe(200);
    const patchBody = TriggerWebhookSchema.parse(await patchResponse.json());
    expect(patchBody.name).toBe("After");
    expect(patchBody.enabled).toBe(false);
    expect(patchBody.integrationWebhookSourceId).toBe("iws_trigger_webhook_update_002");
    expect(patchBody.eventConditions[0]?.actorPolicy).toEqual(SlackWorkspaceActorPolicy);
    expect(patchBody.instructions).toBeNull();
    expect(patchBody.idempotencyKeyTemplate).toBeNull();
    expect(patchBody.target.sandboxProfileId).toBe("sbp_trigger_webhook_update");
    expect(patchBody.target.sandboxProfileVersion).toBe(7);
    expect(patchBody.target.primaryRepositoryId).toBeNull();

    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, "atm_trigger_webhook_update"),
    });
    if (persistedWebhook === undefined) {
      throw new Error("Expected updated webhook config row.");
    }
    expect(persistedWebhook.inputTemplate).toBe("Handle payload");
    expect(persistedWebhook.eventConditions[0]?.actorPolicy).toEqual(SlackWorkspaceActorPolicy);
    expect(persistedWebhook.instructions).toBeNull();
    expect(persistedWebhook.conversationKeyTemplate).toBe("{{payload.issue.node_id}}");
    expect(persistedWebhook.idempotencyKeyTemplate).toBeNull();

    const policyPatchResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_update",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          eventConditions: [
            {
              eventType: "github.issue_comment.created",
              actorPolicy: GitHubTeamActorPolicy,
              payloadFilter: {
                op: "eq",
                path: ["action"],
                value: "created",
              },
            },
          ],
        }),
      },
    );

    expect(policyPatchResponse.status).toBe(200);
    const policyPatchBody = TriggerWebhookSchema.parse(await policyPatchResponse.json());
    expect(policyPatchBody.eventConditions[0]?.actorPolicy).toEqual(GitHubTeamActorPolicy);
  });

  it("sets and clears the selected primary repository", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-update-primary-repository@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_update_primary_repo",
      webhookSourceId: "iws_trigger_webhook_update_primary_repo",
      profileId: "sbp_trigger_webhook_update_primary_repo",
      profileVersion: 4,
      bindingRepositories: ["mistlehq/mistle", "mistlehq/platform"],
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_update_primary_repo",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_update_primary_repo",
      profileId: "sbp_trigger_webhook_update_primary_repo",
      profileVersion: 4,
      targetId: "atg_trigger_webhook_update_primary_repo",
      name: "Primary repo update",
    });

    const setResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_update_primary_repo",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          target: {
            primaryRepositoryId: "mistlehq/platform",
          },
        }),
      },
    );
    expect(setResponse.status).toBe(200);
    const setBody = TriggerWebhookSchema.parse(await setResponse.json());
    expect(setBody.target.primaryRepositoryId).toBe("mistlehq/platform");

    const clearResponse = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_update_primary_repo",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          target: {
            primaryRepositoryId: null,
          },
        }),
      },
    );
    expect(clearResponse.status).toBe(200);
    const clearBody = TriggerWebhookSchema.parse(await clearResponse.json());
    expect(clearBody.target.primaryRepositoryId).toBeNull();
  });

  it("rejects unrelated updates when an existing webhook trigger template is invalid", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-trigger-webhooks-update-stale-invalid-template@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_update_stale_invalid_template",
      webhookSourceId: "iws_trigger_webhook_update_stale_invalid_template",
      profileId: "sbp_trigger_webhook_update_stale_invalid_template",
      profileVersion: 4,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "trg_trigger_webhook_update_stale_invalid_template",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_update_stale_invalid_template",
      profileId: "sbp_trigger_webhook_update_stale_invalid_template",
      profileVersion: 4,
      targetId: "tgt_trigger_webhook_update_stale_invalid_template",
      name: "Stale invalid template",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.webhookTriggers)
      .set({
        inputTemplate: "Handle {{payload.not_real}}",
      })
      .where(
        eq(
          env.controlPlaneTables.webhookTriggers.triggerId,
          "trg_trigger_webhook_update_stale_invalid_template",
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/trg_trigger_webhook_update_stale_invalid_template",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Unrelated rename",
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_TEMPLATE_REFERENCES,
    });
    expect(JSON.stringify(body)).toContain("inputTemplate");
    expect(JSON.stringify(body)).toContain("{{payload.not_real}}");
  });

  it("rejects duplication when the source webhook trigger template is invalid", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-trigger-webhooks-duplicate-stale-invalid-template@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_duplicate_stale_invalid_template",
      webhookSourceId: "iws_trigger_webhook_duplicate_stale_invalid_template",
      profileId: "sbp_trigger_webhook_duplicate_stale_invalid_template",
      profileVersion: 4,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "trg_trigger_webhook_duplicate_stale_invalid_template",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_duplicate_stale_invalid_template",
      profileId: "sbp_trigger_webhook_duplicate_stale_invalid_template",
      profileVersion: 4,
      targetId: "tgt_trigger_webhook_duplicate_stale_invalid_template",
      name: "Stale invalid template",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.webhookTriggers)
      .set({
        conversationKeyTemplate: "{{payload.not_real}}",
      })
      .where(
        eq(
          env.controlPlaneTables.webhookTriggers.triggerId,
          "trg_trigger_webhook_duplicate_stale_invalid_template",
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/trg_trigger_webhook_duplicate_stale_invalid_template/duplicate",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      code: TriggerWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_TEMPLATE_REFERENCES,
    });
    expect(JSON.stringify(body)).toContain("conversationKeyTemplate");
    expect(JSON.stringify(body)).toContain("{{payload.not_real}}");
  });

  it("deletes the webhook trigger aggregate and cascades child rows", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-delete@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_trigger_webhook_delete",
      webhookSourceId: "iws_trigger_webhook_delete",
      profileId: "sbp_trigger_webhook_delete",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_delete",
      organizationId: session.organizationId,
      webhookSourceId: "iws_trigger_webhook_delete",
      profileId: "sbp_trigger_webhook_delete",
      profileVersion: 1,
      targetId: "atg_trigger_webhook_delete",
      name: "Delete Me",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_delete",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = DeleteTriggerWebhookResponseSchema.parse(await response.json());
    expect(body.triggerId).toBe("atm_trigger_webhook_delete");

    const persistedTrigger = await env.controlPlaneDb.query.triggers.findFirst({
      where: (table, { eq }) => eq(table.id, "atm_trigger_webhook_delete"),
    });
    const persistedWebhook = await env.controlPlaneDb.query.webhookTriggers.findFirst({
      where: (table, { eq }) => eq(table.triggerId, "atm_trigger_webhook_delete"),
    });
    const persistedTarget = await env.controlPlaneDb.query.triggerTargets.findFirst({
      where: (table, { eq }) => eq(table.triggerId, "atm_trigger_webhook_delete"),
    });
    expect(persistedTrigger).toBeUndefined();
    expect(persistedWebhook).toBeUndefined();
    expect(persistedTarget).toBeUndefined();
  });

  it("returns 404 for webhook triggers outside the active organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-errors-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-trigger-webhooks-errors-org-b@example.com",
    });
    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: secondOrgSession.organizationId,
      connectionId: "icn_trigger_webhook_other_org",
      webhookSourceId: "iws_trigger_webhook_other_org",
      profileId: "sbp_trigger_webhook_other_org",
      profileVersion: 2,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_trigger_webhook_other_org",
      organizationId: secondOrgSession.organizationId,
      webhookSourceId: "iws_trigger_webhook_other_org",
      profileId: "sbp_trigger_webhook_other_org",
      profileVersion: 2,
      targetId: "atg_trigger_webhook_other_org",
      name: "Other Org",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/triggers/webhooks/atm_trigger_webhook_other_org",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const body = NotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("NOT_FOUND");
  });
});
