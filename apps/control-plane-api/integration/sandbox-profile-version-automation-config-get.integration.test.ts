/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationBindingKinds, IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionAutomationConfigResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profile version automation config get integration", () => {
  it("returns agent bindings and git repository options for the selected profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-automation-config-get@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      integrationTargetRow({
        targetKey: "openai-automation-config-get",
        variantId: "openai-default",
        enabled: true,
      }),
      {
        targetKey: "github-automation-config-get",
        familyId: "git",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_automation_config_agent_001",
        organizationId: session.organizationId,
        targetKey: "openai-automation-config-get",
        displayName: "Automation Config Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_automation_config_git_001",
        organizationId: session.organizationId,
        targetKey: "github-automation-config-get",
        displayName: "Automation Config Git Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_automation_config_get_001",
        organizationId: session.organizationId,
        displayName: "Automation Config Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_automation_config_get_001",
        version: 1,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_automation_config_agent_001",
          sandboxProfileId: "sbp_automation_config_get_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_automation_config_agent_001",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_automation_config_git_001",
          sandboxProfileId: "sbp_automation_config_get_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_automation_config_git_001",
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: ["mistlehq/platform", "mistlehq/mistle"],
          },
        }),
      ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_automation_config_get_001/versions/1/automation-config",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = GetSandboxProfileVersionAutomationConfigResponseSchema.parse(
      await response.json(),
    );
    expect(body.bindings.map((binding) => binding.id)).toEqual([
      "ibd_automation_config_agent_001",
      "ibd_automation_config_git_001",
    ]);
    expect(body.repositoryOptions).toEqual([
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
  });

  it("returns 404 when the selected profile version does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-automation-config-missing@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_automation_config_missing_version_001",
        organizationId: session.organizationId,
        displayName: "Automation Config Missing Version Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_automation_config_missing_version_001/versions/10/automation-config",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxProfileVersionNotFoundResponseSchema.parse(await response.json());
    expect(body.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });
});
