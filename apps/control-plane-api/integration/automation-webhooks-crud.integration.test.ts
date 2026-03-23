import {
  automationTargets,
  automations,
  AutomationKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  SandboxProfileStatuses,
  sandboxProfiles,
  webhookAutomations,
} from "@mistle/db/control-plane";
import { NotFoundResponseSchema, ValidationErrorResponseSchema } from "@mistle/http/errors.js";
import { describe, expect } from "vitest";

import { CreateAutomationWebhookBadRequestResponseSchema } from "../src/automation-webhooks/create-automation-webhook/index.js";
import { ListAutomationWebhooksResponseSchema } from "../src/automation-webhooks/list-automation-webhooks/index.js";
import { AutomationWebhookSchema } from "../src/automation-webhooks/schemas.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

const GitHubTarget = {
  targetKey: "github_cloud",
  familyId: "github",
  variantId: "github-cloud",
  enabled: true,
  config: {
    base_url: "https://github.com",
  },
};

const OpenAiTarget = {
  targetKey: "openai-default",
  familyId: "openai",
  variantId: "openai-default",
  enabled: true,
  config: {
    api_base_url: "https://api.openai.com",
  },
};

describe("automation webhooks CRUD integration", () => {
  it("creates a webhook automation aggregate in the authenticated user's active organization", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-webhooks-create@example.com",
    });

    await insertIntegrationTargets(fixture);
    await insertIntegrationConnection(fixture, {
      id: "icn_webhook_create_001",
      organizationId: authenticatedSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_webhook_create_001",
      organizationId: authenticatedSession.organizationId,
    });

    const requestBody = {
      name: "GitHub Issue Comments",
      enabled: true,
      integrationConnectionId: "icn_webhook_create_001",
      eventTypes: ["issue_comment.created"],
      payloadFilter: {
        action: "created",
      },
      inputTemplate: "Handle {{payload.comment.body}}",
      conversationKeyTemplate: "{{payload.issue.node_id}}",
      idempotencyKeyTemplate: "{{payload.comment.node_id}}",
      target: {
        sandboxProfileId: "sbp_webhook_create_001",
        sandboxProfileVersion: 3,
      },
    };

    const response = await fixture.request("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(201);
    const body = AutomationWebhookSchema.parse(await response.json());
    expect(body.kind).toBe("webhook");
    expect(body.name).toBe("GitHub Issue Comments");
    expect(body.enabled).toBe(true);
    expect(body.integrationConnectionId).toBe("icn_webhook_create_001");
    expect(body.eventTypes).toEqual(["issue_comment.created"]);
    expect(body.payloadFilter).toEqual({ action: "created" });
    expect(body.target.sandboxProfileId).toBe("sbp_webhook_create_001");
    expect(body.target.sandboxProfileVersion).toBe(3);

    const persistedAutomation = await fixture.db.query.automations.findFirst({
      where: (table, { eq }) => eq(table.id, body.id),
    });
    expect(persistedAutomation).toBeDefined();
    if (persistedAutomation === undefined) {
      throw new Error("Expected created automation to be persisted.");
    }
    expect(persistedAutomation.organizationId).toBe(authenticatedSession.organizationId);
    expect(persistedAutomation.kind).toBe(AutomationKinds.WEBHOOK);
    expect(persistedAutomation.name).toBe("GitHub Issue Comments");

    const persistedWebhook = await fixture.db.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, body.id),
    });
    expect(persistedWebhook).toBeDefined();
    if (persistedWebhook === undefined) {
      throw new Error("Expected created webhook automation config to be persisted.");
    }
    expect(persistedWebhook.integrationConnectionId).toBe("icn_webhook_create_001");
    expect(persistedWebhook.eventTypes).toEqual(["issue_comment.created"]);
    expect(persistedWebhook.payloadFilter).toEqual({ action: "created" });

    const persistedTargets = await fixture.db.query.automationTargets.findMany({
      where: (table, { eq }) => eq(table.automationId, body.id),
    });
    expect(persistedTargets).toHaveLength(1);
    const [persistedTarget] = persistedTargets;
    if (persistedTarget === undefined) {
      throw new Error("Expected automation target row to exist.");
    }
    expect(persistedTarget.sandboxProfileId).toBe("sbp_webhook_create_001");
    expect(persistedTarget.sandboxProfileVersion).toBe(3);
  });

  it("lists webhook automations with keyset pagination scoped to the active organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "automation-webhooks-list-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "automation-webhooks-list-org-b@example.com",
    });

    await insertIntegrationTargets(fixture);
    await insertIntegrationConnection(fixture, {
      id: "icn_list_001",
      organizationId: firstOrgSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertIntegrationConnection(fixture, {
      id: "icn_list_002",
      organizationId: firstOrgSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertIntegrationConnection(fixture, {
      id: "icn_list_003",
      organizationId: firstOrgSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertIntegrationConnection(fixture, {
      id: "icn_list_004",
      organizationId: secondOrgSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_list_001",
      organizationId: firstOrgSession.organizationId,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_list_002",
      organizationId: firstOrgSession.organizationId,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_list_003",
      organizationId: firstOrgSession.organizationId,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_list_004",
      organizationId: secondOrgSession.organizationId,
    });

    await fixture.db.insert(automations).values([
      {
        id: "atm_webhook_list_001",
        organizationId: firstOrgSession.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "First",
        enabled: true,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "atm_webhook_list_002",
        organizationId: firstOrgSession.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Second",
        enabled: false,
        createdAt: "2026-02-02T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
      {
        id: "atm_webhook_list_003",
        organizationId: firstOrgSession.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Third",
        enabled: true,
        createdAt: "2026-02-03T00:00:00.000Z",
        updatedAt: "2026-02-03T00:00:00.000Z",
      },
      {
        id: "atm_webhook_list_other_org",
        organizationId: secondOrgSession.organizationId,
        kind: AutomationKinds.WEBHOOK,
        name: "Other Org",
        enabled: true,
        createdAt: "2026-02-04T00:00:00.000Z",
        updatedAt: "2026-02-04T00:00:00.000Z",
      },
    ]);

    await fixture.db
      .insert(webhookAutomations)
      .values([
        createPersistedWebhookAutomationConfig("atm_webhook_list_001", "icn_list_001"),
        createPersistedWebhookAutomationConfig("atm_webhook_list_002", "icn_list_002"),
        createPersistedWebhookAutomationConfig("atm_webhook_list_003", "icn_list_003"),
        createPersistedWebhookAutomationConfig("atm_webhook_list_other_org", "icn_list_004"),
      ]);

    await fixture.db
      .insert(automationTargets)
      .values([
        createPersistedAutomationTarget("atg_list_001", "atm_webhook_list_001", "sbp_list_001", 1),
        createPersistedAutomationTarget("atg_list_002", "atm_webhook_list_002", "sbp_list_002", 2),
        createPersistedAutomationTarget("atg_list_003", "atm_webhook_list_003", "sbp_list_003", 3),
        createPersistedAutomationTarget(
          "atg_list_004",
          "atm_webhook_list_other_org",
          "sbp_list_004",
          4,
        ),
      ]);

    const firstPageResponse = await fixture.request("/v1/automations/webhooks?limit=2", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListAutomationWebhooksResponseSchema.parse(await firstPageResponse.json());
    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((item) => item.id)).toEqual([
      "atm_webhook_list_003",
      "atm_webhook_list_002",
    ]);
    expect(firstPage.nextPage).not.toBeNull();
    expect(firstPage.previousPage).toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await fixture.request(
      `/v1/automations/webhooks?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListAutomationWebhooksResponseSchema.parse(await secondPageResponse.json());
    expect(secondPage.totalResults).toBe(3);
    expect(secondPage.items.map((item) => item.id)).toEqual(["atm_webhook_list_001"]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();
  });

  it("gets and updates a webhook automation aggregate while preserving omitted PATCH fields", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-webhooks-get-update@example.com",
    });

    await insertIntegrationTargets(fixture);
    await insertIntegrationConnection(fixture, {
      id: "icn_webhook_update_001",
      organizationId: authenticatedSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertIntegrationConnection(fixture, {
      id: "icn_webhook_update_002",
      organizationId: authenticatedSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_webhook_update_001",
      organizationId: authenticatedSession.organizationId,
    });

    await fixture.db.insert(automations).values({
      id: "atm_webhook_update_001",
      organizationId: authenticatedSession.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: "Before",
      enabled: true,
      createdAt: "2026-02-05T00:00:00.000Z",
      updatedAt: "2026-02-05T00:00:00.000Z",
    });
    await fixture.db
      .insert(webhookAutomations)
      .values(
        createPersistedWebhookAutomationConfig("atm_webhook_update_001", "icn_webhook_update_001"),
      );
    await fixture.db
      .insert(automationTargets)
      .values(
        createPersistedAutomationTarget(
          "atg_webhook_update_001",
          "atm_webhook_update_001",
          "sbp_webhook_update_001",
          7,
        ),
      );

    const getResponse = await fixture.request("/v1/automations/webhooks/atm_webhook_update_001", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(getResponse.status).toBe(200);
    const getBody = AutomationWebhookSchema.parse(await getResponse.json());
    expect(getBody.name).toBe("Before");
    expect(getBody.integrationConnectionId).toBe("icn_webhook_update_001");
    expect(getBody.target.sandboxProfileVersion).toBe(7);

    const patchResponse = await fixture.request("/v1/automations/webhooks/atm_webhook_update_001", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "After",
        enabled: false,
        integrationConnectionId: "icn_webhook_update_002",
        target: {
          sandboxProfileId: "sbp_webhook_update_001",
        },
        idempotencyKeyTemplate: null,
      }),
    });
    expect(patchResponse.status).toBe(200);
    const patchBody = AutomationWebhookSchema.parse(await patchResponse.json());
    expect(patchBody.name).toBe("After");
    expect(patchBody.enabled).toBe(false);
    expect(patchBody.integrationConnectionId).toBe("icn_webhook_update_002");
    expect(patchBody.idempotencyKeyTemplate).toBeNull();
    expect(patchBody.target.sandboxProfileVersion).toBe(7);
    expect(patchBody.updatedAt).not.toBe("2026-02-05T00:00:00.000Z");

    const persistedWebhook = await fixture.db.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, "atm_webhook_update_001"),
    });
    if (persistedWebhook === undefined) {
      throw new Error("Expected updated webhook config row.");
    }
    expect(persistedWebhook.inputTemplate).toBe("Handle payload");
    expect(persistedWebhook.conversationKeyTemplate).toBe("{{payload.issue.node_id}}");
    expect(persistedWebhook.idempotencyKeyTemplate).toBeNull();

    const persistedTarget = await fixture.db.query.automationTargets.findFirst({
      where: (table, { eq }) => eq(table.id, "atg_webhook_update_001"),
    });
    if (persistedTarget === undefined) {
      throw new Error("Expected updated automation target row.");
    }
    expect(persistedTarget.sandboxProfileVersion).toBe(7);
  });

  it("deletes a webhook automation aggregate and cascades child rows", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-webhooks-delete@example.com",
    });

    await insertIntegrationTargets(fixture);
    await insertIntegrationConnection(fixture, {
      id: "icn_delete_001",
      organizationId: authenticatedSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_delete_001",
      organizationId: authenticatedSession.organizationId,
    });

    await fixture.db.insert(automations).values({
      id: "atm_webhook_delete_001",
      organizationId: authenticatedSession.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: "Delete Me",
      enabled: true,
      createdAt: "2026-02-06T00:00:00.000Z",
      updatedAt: "2026-02-06T00:00:00.000Z",
    });
    await fixture.db
      .insert(webhookAutomations)
      .values(createPersistedWebhookAutomationConfig("atm_webhook_delete_001", "icn_delete_001"));
    await fixture.db
      .insert(automationTargets)
      .values(
        createPersistedAutomationTarget(
          "atg_webhook_delete_001",
          "atm_webhook_delete_001",
          "sbp_delete_001",
          1,
        ),
      );

    const response = await fixture.request("/v1/automations/webhooks/atm_webhook_delete_001", {
      method: "DELETE",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      automationId: "atm_webhook_delete_001",
    });

    const persistedAutomation = await fixture.db.query.automations.findFirst({
      where: (table, { eq }) => eq(table.id, "atm_webhook_delete_001"),
    });
    const persistedWebhook = await fixture.db.query.webhookAutomations.findFirst({
      where: (table, { eq }) => eq(table.automationId, "atm_webhook_delete_001"),
    });
    const persistedTarget = await fixture.db.query.automationTargets.findFirst({
      where: (table, { eq }) => eq(table.automationId, "atm_webhook_delete_001"),
    });
    expect(persistedAutomation).toBeUndefined();
    expect(persistedWebhook).toBeUndefined();
    expect(persistedTarget).toBeUndefined();
  });

  it("returns 400 when creating a webhook automation for a non-webhook-capable connection target", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "automation-webhooks-invalid-connection@example.com",
    });

    await insertIntegrationTargets(fixture);
    await insertIntegrationConnection(fixture, {
      id: "icn_webhook_invalid_001",
      organizationId: authenticatedSession.organizationId,
      targetKey: OpenAiTarget.targetKey,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_webhook_invalid_001",
      organizationId: authenticatedSession.organizationId,
    });

    const response = await fixture.request("/v1/automations/webhooks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        name: "Invalid",
        integrationConnectionId: "icn_webhook_invalid_001",
        inputTemplate: "Handle payload",
        conversationKeyTemplate: "{{payload.issue.node_id}}",
        target: {
          sandboxProfileId: "sbp_webhook_invalid_001",
        },
      }),
    });
    expect(response.status).toBe(400);
    const body = CreateAutomationWebhookBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("CONNECTION_TARGET_NOT_WEBHOOK_CAPABLE");
  });

  it("returns 404 for webhook automations outside the active organization and 400 for invalid payloads", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "automation-webhooks-errors-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "automation-webhooks-errors-org-b@example.com",
    });

    await insertIntegrationTargets(fixture);
    await insertIntegrationConnection(fixture, {
      id: "icn_other_org_001",
      organizationId: secondOrgSession.organizationId,
      targetKey: GitHubTarget.targetKey,
    });
    await insertSandboxProfile(fixture, {
      id: "sbp_other_org_001",
      organizationId: secondOrgSession.organizationId,
    });

    await fixture.db.insert(automations).values({
      id: "atm_webhook_other_org_001",
      organizationId: secondOrgSession.organizationId,
      kind: AutomationKinds.WEBHOOK,
      name: "Other Org",
      enabled: true,
      createdAt: "2026-02-07T00:00:00.000Z",
      updatedAt: "2026-02-07T00:00:00.000Z",
    });
    await fixture.db
      .insert(webhookAutomations)
      .values(
        createPersistedWebhookAutomationConfig("atm_webhook_other_org_001", "icn_other_org_001"),
      );
    await fixture.db
      .insert(automationTargets)
      .values(
        createPersistedAutomationTarget(
          "atg_webhook_other_org_001",
          "atm_webhook_other_org_001",
          "sbp_other_org_001",
          2,
        ),
      );

    const notFoundResponse = await fixture.request(
      "/v1/automations/webhooks/atm_webhook_other_org_001",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(notFoundResponse.status).toBe(404);
    const notFoundBody = NotFoundResponseSchema.parse(await notFoundResponse.json());
    expect(notFoundBody.code).toBe("NOT_FOUND");

    const invalidPatchResponse = await fixture.request("/v1/automations/webhooks/atm_invalid", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({}),
    });
    expect(invalidPatchResponse.status).toBe(400);
    const validationBody = ValidationErrorResponseSchema.parse(await invalidPatchResponse.json());
    expect(validationBody.code).toBe("VALIDATION_ERROR");
    expect(validationBody.message).toBe("Invalid request.");
  });
});

async function insertIntegrationTargets(fixture: ControlPlaneApiIntegrationFixture) {
  await fixture.db
    .insert(integrationTargets)
    .values([GitHubTarget, OpenAiTarget])
    .onConflictDoNothing();
}

async function insertIntegrationConnection(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    id: string;
    organizationId: string;
    targetKey: string;
  },
) {
  await fixture.db.insert(integrationConnections).values({
    id: input.id,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: `${input.id} display`,
    status: IntegrationConnectionStatuses.ACTIVE,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });
}

async function insertSandboxProfile(
  fixture: ControlPlaneApiIntegrationFixture,
  input: {
    id: string;
    organizationId: string;
  },
) {
  await fixture.db.insert(sandboxProfiles).values({
    id: input.id,
    organizationId: input.organizationId,
    displayName: `${input.id} display`,
    status: SandboxProfileStatuses.ACTIVE,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });
}

function createPersistedWebhookAutomationConfig(
  automationId: string,
  integrationConnectionId: string,
) {
  return {
    automationId,
    integrationConnectionId,
    eventTypes: ["issue_comment.created"],
    payloadFilter: {
      action: "created",
    },
    inputTemplate: "Handle payload",
    conversationKeyTemplate: "{{payload.issue.node_id}}",
    idempotencyKeyTemplate: "{{payload.comment.node_id}}",
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
}

function createPersistedAutomationTarget(
  id: string,
  automationId: string,
  sandboxProfileId: string,
  sandboxProfileVersion: number,
) {
  return {
    id,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  };
}
