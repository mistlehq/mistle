/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationBindingKinds, IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionTriggerConfigResponseSchema,
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

describe.concurrent("sandbox profile version trigger config get integration", () => {
  it("returns agent bindings and git repository options for the selected profile version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-trigger-config-get@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      integrationTargetRow({
        targetKey: "openai-trigger-config-get",
        variantId: "openai-default",
        enabled: true,
      }),
      {
        targetKey: "github-trigger-config-get",
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
        id: "icn_trigger_config_agent_001",
        organizationId: session.organizationId,
        targetKey: "openai-trigger-config-get",
        displayName: "Trigger Config Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_trigger_config_git_001",
        organizationId: session.organizationId,
        targetKey: "github-trigger-config-get",
        displayName: "Trigger Config Git Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_trigger_config_get_001",
        organizationId: session.organizationId,
        displayName: "Trigger Config Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_trigger_config_get_001",
        version: 1,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_trigger_config_agent_001",
          sandboxProfileId: "sbp_trigger_config_get_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_trigger_config_agent_001",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_trigger_config_git_001",
          sandboxProfileId: "sbp_trigger_config_get_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_trigger_config_git_001",
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: ["mistlehq/platform", "mistlehq/mistle"],
          },
        }),
      ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_trigger_config_get_001/versions/1/trigger-config",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = GetSandboxProfileVersionTriggerConfigResponseSchema.parse(await response.json());
    expect(body.bindings.map((binding) => binding.id)).toEqual([
      "ibd_trigger_config_agent_001",
      "ibd_trigger_config_git_001",
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
      email: "integration-new-sandbox-profile-version-trigger-config-missing@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_trigger_config_missing_version_001",
        organizationId: session.organizationId,
        displayName: "Trigger Config Missing Version Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_trigger_config_missing_version_001/versions/10/trigger-config",
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
