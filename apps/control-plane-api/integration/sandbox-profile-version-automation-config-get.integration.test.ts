import {
  integrationConnections,
  integrationTargets,
  IntegrationBindingKinds,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionAutomationConfigResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createIntegrationTargetFixture,
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile version automation config get integration", () => {
  it("returns bindings and repository options for the specified profile version", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-automation-config-get@example.com",
    });

    await fixture.db.insert(integrationTargets).values([
      createIntegrationTargetFixture({
        targetKey: "openai-automation-config-get",
        variantId: "openai-default",
        enabled: true,
      }),
      {
        ...createIntegrationTargetFixture({
          targetKey: "github-automation-config-get",
          variantId: "github-cloud",
          enabled: true,
        }),
        familyId: "git",
      },
    ]);
    const [agentConnection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_automation_config_agent_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-automation-config-get",
        displayName: "Automation Config Agent Connection",
      })
      .returning();
    const [gitConnection] = await fixture.db
      .insert(integrationConnections)
      .values({
        id: "icn_automation_config_git_001",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-automation-config-get",
        displayName: "Automation Config Git Connection",
      })
      .returning();

    if (agentConnection === undefined || gitConnection === undefined) {
      throw new Error("Expected integration connections to be inserted.");
    }

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_automation_config_get_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Automation Config Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_automation_config_get_001",
        version: 1,
      }),
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      {
        ...createSandboxProfileVersionIntegrationBindingFixture({
          id: "ibd_automation_config_agent_001",
          sandboxProfileId: "sbp_automation_config_get_001",
          sandboxProfileVersion: 1,
          connectionId: agentConnection.id,
          kind: IntegrationBindingKinds.AGENT,
        }),
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
          model: {
            defaultModel: "gpt-5.3-codex",
            options: {},
          },
        },
      },
      {
        ...createSandboxProfileVersionIntegrationBindingFixture({
          id: "ibd_automation_config_git_001",
          sandboxProfileId: "sbp_automation_config_get_001",
          sandboxProfileVersion: 1,
          connectionId: gitConnection.id,
          kind: IntegrationBindingKinds.GIT,
        }),
        config: {
          repositories: ["mistlehq/platform", "mistlehq/mistle"],
        },
      },
    ]);

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_automation_config_get_001/versions/1/automation-config",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionAutomationConfigResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.bindings).toHaveLength(2);
    expect(responseBody.bindings.map((binding) => binding.id)).toEqual([
      "ibd_automation_config_agent_001",
      "ibd_automation_config_git_001",
    ]);
    expect(responseBody.repositoryOptions).toEqual([
      {
        id: "mistlehq/mistle",
        label: "mistlehq/mistle",
        path: "/root/mistlehq/mistle",
      },
      {
        id: "mistlehq/platform",
        label: "mistlehq/platform",
        path: "/root/mistlehq/platform",
      },
    ]);
  }, 60_000);

  it("returns 404 when profile version is missing", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-automation-config-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_automation_config_missing_version_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Automation Config Missing Version Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_automation_config_missing_version_001/versions/10/automation-config",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);
});
