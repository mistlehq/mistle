import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  integrationConnections,
  integrationTargets,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  sandboxProfiles,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { ListAutomationApplicableSandboxProfilesResponseSchema } from "../src/sandbox-profiles/index.js";
import {
  createSandboxProfileGraphFixtures,
  createIntegrationConnectionFixture,
  createIntegrationTargetFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profiles automation applicable integration", () => {
  it("returns latest-version profiles with eligible webhook trigger connections", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-automation-applicable@example.com",
    });

    const profileGraph = createSandboxProfileGraphFixtures({
      organizationId: authenticatedSession.organizationId,
      profiles: [
        {
          id: "sbp_automation_applicable",
          displayName: "Automation Applicable",
          createdAt: "2026-01-05T00:00:00.000Z",
          versions: [1, 2],
          bindings: [
            {
              id: "ibd_automation_applicable_github",
              sandboxProfileVersion: 2,
              connectionId: "icn_automation_github",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
            {
              id: "ibd_automation_applicable_slack",
              sandboxProfileVersion: 2,
              connectionId: "icn_automation_slack",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
          ],
        },
        {
          id: "sbp_automation_old_only",
          displayName: "Old Version Only",
          createdAt: "2026-01-04T00:00:00.000Z",
          versions: [1, 2],
          bindings: [
            {
              id: "ibd_automation_old_only_v1",
              sandboxProfileVersion: 1,
              connectionId: "icn_automation_github",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
          ],
        },
        {
          id: "sbp_automation_disabled_target",
          displayName: "Disabled Target",
          createdAt: "2026-01-03T00:00:00.000Z",
          versions: [1],
          bindings: [
            {
              id: "ibd_automation_disabled_target_v1",
              sandboxProfileVersion: 1,
              connectionId: "icn_automation_disabled_target",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
          ],
        },
        {
          id: "sbp_automation_inactive_connection",
          displayName: "Inactive Connection",
          createdAt: "2026-01-02T00:00:00.000Z",
          versions: [1],
          bindings: [
            {
              id: "ibd_automation_inactive_connection_v1",
              sandboxProfileVersion: 1,
              connectionId: "icn_automation_inactive",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
          ],
        },
        {
          id: "sbp_automation_non_webhook_target",
          displayName: "Non Webhook Target",
          createdAt: "2026-01-01T00:00:00.000Z",
          versions: [1],
          bindings: [
            {
              id: "ibd_automation_non_webhook_target_v1",
              sandboxProfileVersion: 1,
              connectionId: "icn_automation_openai",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
          ],
        },
        {
          id: "sbp_automation_unknown_definition",
          displayName: "Unknown Definition",
          createdAt: "2025-12-31T00:00:00.000Z",
          versions: [1],
          bindings: [
            {
              id: "ibd_automation_unknown_definition_v1",
              sandboxProfileVersion: 1,
              connectionId: "icn_automation_unknown_definition",
              kind: IntegrationBindingKinds.CONNECTOR,
            },
          ],
        },
      ],
    });

    await fixture.db.insert(sandboxProfiles).values(profileGraph.sandboxProfiles);
    await fixture.db.insert(sandboxProfileVersions).values(profileGraph.sandboxProfileVersions);

    await fixture.db.insert(integrationTargets).values([
      createIntegrationTargetFixture({
        targetKey: "github-automation-applicable",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
      }),
      createIntegrationTargetFixture({
        targetKey: "slack-automation-applicable",
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
      }),
      createIntegrationTargetFixture({
        targetKey: "openai-automation-disabled",
        variantId: "openai-default",
        enabled: false,
      }),
      createIntegrationTargetFixture({
        targetKey: "openai-automation-applicable",
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
      }),
      createIntegrationTargetFixture({
        targetKey: "unknown-automation-applicable",
        familyId: "retired-family",
        variantId: "retired-variant",
        enabled: true,
      }),
    ]);

    await fixture.db.insert(integrationConnections).values([
      createIntegrationConnectionFixture({
        id: "icn_automation_github",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-automation-applicable",
        displayName: "GitHub",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_automation_slack",
        organizationId: authenticatedSession.organizationId,
        targetKey: "slack-automation-applicable",
        displayName: "Slack",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_automation_disabled_target",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-automation-disabled",
        displayName: "OpenAI Disabled",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_automation_inactive",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-automation-applicable",
        displayName: "GitHub Inactive",
        status: IntegrationConnectionStatuses.REVOKED,
      }),
      createIntegrationConnectionFixture({
        id: "icn_automation_openai",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-automation-applicable",
        displayName: "OpenAI",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_automation_unknown_definition",
        organizationId: authenticatedSession.organizationId,
        targetKey: "unknown-automation-applicable",
        displayName: "Unknown Definition",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await fixture.db
      .insert(sandboxProfileVersionIntegrationBindings)
      .values(profileGraph.sandboxProfileVersionIntegrationBindings);

    const response = await fixture.request("/v1/sandbox/profiles/automation-applicable", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(200);

    const body = ListAutomationApplicableSandboxProfilesResponseSchema.parse(await response.json());
    expect(body.items).toStrictEqual([
      {
        id: "sbp_automation_applicable",
        organizationId: authenticatedSession.organizationId,
        displayName: "Automation Applicable",
        status: "active",
        latestVersion: 2,
        eligibleIntegrationConnectionIds: ["icn_automation_github"],
        createdAt: "2026-01-05T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
      },
    ]);
  });
});
