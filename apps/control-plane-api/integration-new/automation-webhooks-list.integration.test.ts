/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListAutomationWebhooksResponseSchema } from "../src/automation-webhooks/list-automation-webhooks/index.js";
import {
  GitHubIssueCommentCreatedEventType,
  seedAutomationWebhookTargets,
  seedPersistedWebhookAutomation,
  seedWebhookAutomationFixture,
} from "./helpers/automation-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("automation webhooks list integration", () => {
  it("returns keyset-paginated webhook automations scoped to the active organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-automation-webhooks-list-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-automation-webhooks-list-org-b@example.com",
    });
    await seedAutomationWebhookTargets(env);
    await seedWebhookAutomationFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_automation_webhook_list_001",
      webhookSourceId: "iws_automation_webhook_list_001",
      profileId: "sbp_automation_webhook_list_001",
      profileVersion: 1,
    });
    await seedWebhookAutomationFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_automation_webhook_list_002",
      webhookSourceId: "iws_automation_webhook_list_002",
      profileId: "sbp_automation_webhook_list_002",
      profileVersion: 2,
    });
    await seedWebhookAutomationFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_automation_webhook_list_003",
      webhookSourceId: "iws_automation_webhook_list_003",
      profileId: "sbp_automation_webhook_list_003",
      profileVersion: 3,
    });
    await seedWebhookAutomationFixture(env, {
      organizationId: secondOrgSession.organizationId,
      connectionId: "icn_automation_webhook_list_other_org",
      webhookSourceId: "iws_automation_webhook_list_other_org",
      profileId: "sbp_automation_webhook_list_other_org",
      profileVersion: 4,
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automation_webhook_list_001",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_automation_webhook_list_001",
      profileId: "sbp_automation_webhook_list_001",
      profileVersion: 1,
      targetId: "atg_automation_webhook_list_001",
      name: "First",
      createdAt: "2026-02-01T00:00:00.000Z",
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automation_webhook_list_002",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_automation_webhook_list_002",
      profileId: "sbp_automation_webhook_list_002",
      profileVersion: 2,
      targetId: "atg_automation_webhook_list_002",
      name: "Second",
      enabled: false,
      createdAt: "2026-02-02T00:00:00.000Z",
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automation_webhook_list_003",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_automation_webhook_list_003",
      profileId: "sbp_automation_webhook_list_003",
      profileVersion: 3,
      targetId: "atg_automation_webhook_list_003",
      name: "Third",
      createdAt: "2026-02-03T00:00:00.000Z",
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automation_webhook_list_other_org",
      organizationId: secondOrgSession.organizationId,
      webhookSourceId: "iws_automation_webhook_list_other_org",
      profileId: "sbp_automation_webhook_list_other_org",
      profileVersion: 4,
      targetId: "atg_automation_webhook_list_other_org",
      name: "Other Org",
      createdAt: "2026-02-04T00:00:00.000Z",
    });

    const firstPageResponse = await env.controlPlaneApi.http.fetch(
      "/v1/automations/webhooks?limit=2",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListAutomationWebhooksResponseSchema.parse(await firstPageResponse.json());
    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((item) => item.id)).toEqual([
      "atm_automation_webhook_list_003",
      "atm_automation_webhook_list_002",
    ]);
    expect(firstPage.items[0]?.events).toEqual([
      {
        label: "Issue comment created",
        logoKey: "github",
      },
    ]);
    expect(firstPage.nextPage).not.toBeNull();
    expect(firstPage.previousPage).toBeNull();
    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await env.controlPlaneApi.http.fetch(
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
    expect(secondPage.items.map((item) => item.id)).toEqual(["atm_automation_webhook_list_001"]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();
  });

  it("reports an item-level issue when persisted target metadata no longer has a definition", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-automation-webhooks-list-retired-target@example.com",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values({
      targetKey: "retired-automation-webhook-target",
      familyId: "retired",
      variantId: "retired-variant",
      enabled: true,
      config: {},
      displayNameOverride: "Retired target",
      descriptionOverride: "Retired target description",
    });
    await seedWebhookAutomationFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_automation_webhook_list_retired_target",
      webhookSourceId: "iws_automation_webhook_list_retired_target",
      profileId: "sbp_automation_webhook_list_retired_target",
      profileVersion: 1,
      targetKey: "retired-automation-webhook-target",
    });
    await seedPersistedWebhookAutomation(env, {
      automationId: "atm_automation_webhook_list_retired_target",
      organizationId: session.organizationId,
      webhookSourceId: "iws_automation_webhook_list_retired_target",
      profileId: "sbp_automation_webhook_list_retired_target",
      profileVersion: 1,
      targetId: "atg_automation_webhook_list_retired_target",
      name: "Retired Target Automation",
      createdAt: "2026-02-07T00:00:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/automations/webhooks", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = ListAutomationWebhooksResponseSchema.parse(await response.json());
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    if (item === undefined) {
      throw new Error("Expected a webhook automation list item.");
    }
    expect(item.id).toBe("atm_automation_webhook_list_retired_target");
    expect(item.issue).toEqual({
      code: "MISSING_TARGET_METADATA",
      message:
        "This automation references an integration target definition that is no longer available. Event metadata may be incomplete.",
    });
    expect(item.events).toEqual([
      {
        label: GitHubIssueCommentCreatedEventType,
        unavailable: true,
      },
    ]);
  });
});
