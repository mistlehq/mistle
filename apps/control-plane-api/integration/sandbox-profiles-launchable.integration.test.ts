/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListLaunchableSandboxProfilesResponseSchema } from "../src/sandbox-profiles/index.js";
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

describe.concurrent("sandbox profiles launchable integration", () => {
  it("returns active published profiles with agent runtimes ordered by recency", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profiles-launchable@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      sandboxProfileRow({
        id: "sbp_launchable_agent_with_repos",
        organizationId: session.organizationId,
        displayName: "Launchable Agent With Repos Profile",
        activeVersion: 1,
        createdAt: "2026-01-04T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_agent",
        organizationId: session.organizationId,
        displayName: "Launchable Agent Profile",
        activeVersion: 2,
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_git_only",
        organizationId: session.organizationId,
        displayName: "Git Only Profile",
        activeVersion: 1,
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_old_agent_only",
        organizationId: session.organizationId,
        displayName: "Old Agent Only Profile",
        activeVersion: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_inactive_connection",
        organizationId: session.organizationId,
        displayName: "Inactive Connection Profile",
        activeVersion: 1,
        createdAt: "2025-12-31T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_disabled_target",
        organizationId: session.organizationId,
        displayName: "Disabled Target Profile",
        activeVersion: 1,
        createdAt: "2025-12-30T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_mixed_bindings",
        organizationId: session.organizationId,
        displayName: "Mixed Bindings Profile",
        activeVersion: 1,
        createdAt: "2025-12-29T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_draft_only",
        organizationId: session.organizationId,
        displayName: "Draft Only Profile",
        activeVersion: null,
        createdAt: "2025-12-28T00:00:00.000Z",
      }),
      sandboxProfileRow({
        id: "sbp_launchable_active_draft",
        organizationId: session.organizationId,
        displayName: "Active Draft Profile",
        activeVersion: 1,
        createdAt: "2025-12-27T00:00:00.000Z",
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_agent_with_repos",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_agent",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_agent",
        version: 2,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_git_only",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_old_agent_only",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_old_agent_only",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_inactive_connection",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_disabled_target",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_mixed_bindings",
        version: 1,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_draft_only",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_launchable_active_draft",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      integrationTargetRow({
        targetKey: "openai-sandbox-profiles-launchable",
        variantId: "openai-default",
        enabled: true,
      }),
      integrationTargetRow({
        targetKey: "openai-sandbox-profiles-launchable-disabled",
        variantId: "openai-disabled",
        enabled: false,
      }),
      {
        targetKey: "github-cloud-sandbox-profiles-launchable",
        familyId: "github",
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
        id: "icn_sandbox_profiles_launchable",
        organizationId: session.organizationId,
        targetKey: "openai-sandbox-profiles-launchable",
        displayName: "Sandbox profiles launchable connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
      integrationConnectionRow({
        id: "icn_sandbox_profiles_launchable_inactive",
        organizationId: session.organizationId,
        targetKey: "openai-sandbox-profiles-launchable",
        displayName: "Inactive launchable connection",
        status: IntegrationConnectionStatuses.REVOKED,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
      integrationConnectionRow({
        id: "icn_sandbox_profiles_launchable_disabled_target",
        organizationId: session.organizationId,
        targetKey: "openai-sandbox-profiles-launchable-disabled",
        displayName: "Disabled target launchable connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
      integrationConnectionRow({
        id: "icn_sandbox_profiles_launchable_github",
        organizationId: session.organizationId,
        targetKey: "github-cloud-sandbox-profiles-launchable",
        displayName: "Launchable GitHub connection",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    ]);

    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_agent_with_repos_agent_v1",
          sandboxProfileId: "sbp_launchable_agent_with_repos",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_agent_with_repos_git_v1",
          sandboxProfileId: "sbp_launchable_agent_with_repos",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable_github",
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: ["mistlehq/mistle", "mistlehq/platform"],
            tools: [],
          },
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_agent_v2",
          sandboxProfileId: "sbp_launchable_agent",
          sandboxProfileVersion: 2,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_git_only_v1",
          sandboxProfileId: "sbp_launchable_git_only",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable_github",
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: ["mistlehq/git-only"],
            tools: [],
          },
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_old_agent_v1",
          sandboxProfileId: "sbp_launchable_old_agent_only",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_old_agent_v2",
          sandboxProfileId: "sbp_launchable_old_agent_only",
          sandboxProfileVersion: 2,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.GIT,
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_inactive_connection_v1",
          sandboxProfileId: "sbp_launchable_inactive_connection",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable_inactive",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_disabled_target_v1",
          sandboxProfileId: "sbp_launchable_disabled_target",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable_disabled_target",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_mixed_bindings_valid_v1",
          sandboxProfileId: "sbp_launchable_mixed_bindings",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_mixed_bindings_invalid_v1",
          sandboxProfileId: "sbp_launchable_mixed_bindings",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable_inactive",
          kind: IntegrationBindingKinds.GIT,
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_draft_only_v1",
          sandboxProfileId: "sbp_launchable_draft_only",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_launchable_active_draft_v1",
          sandboxProfileId: "sbp_launchable_active_draft",
          sandboxProfileVersion: 1,
          connectionId: "icn_sandbox_profiles_launchable",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      ]);

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles/launchable", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const body = ListLaunchableSandboxProfilesResponseSchema.parse(await response.json());

    expect(body.items.map((profile) => profile.id)).toEqual([
      "sbp_launchable_agent_with_repos",
      "sbp_launchable_agent",
      "sbp_launchable_git_only",
      "sbp_launchable_old_agent_only",
      "sbp_launchable_inactive_connection",
      "sbp_launchable_disabled_target",
      "sbp_launchable_mixed_bindings",
    ]);
    expect(body.items[0]).toMatchObject({
      id: "sbp_launchable_agent_with_repos",
      organizationId: session.organizationId,
      displayName: "Launchable Agent With Repos Profile",
      activeVersion: 1,
      latestVersion: 1,
      repositoryOptions: [
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
      ],
    });
  });
});
