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

import { ListLaunchableSandboxProfilesResponseSchema } from "../src/sandbox-profiles/index.js";
import {
  createIntegrationConnectionFixture,
  createIntegrationTargetFixture,
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profiles launchable integration", () => {
  it("returns non-paginated launchable profiles with latest versions", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profiles-launchable@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values([
      createSandboxProfileFixture({
        id: "sbp_launchable_agent",
        organizationId: authenticatedSession.organizationId,
        displayName: "Launchable Agent Profile",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      createSandboxProfileFixture({
        id: "sbp_launchable_git_only",
        organizationId: authenticatedSession.organizationId,
        displayName: "Git Only Profile",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      createSandboxProfileFixture({
        id: "sbp_launchable_old_agent_only",
        organizationId: authenticatedSession.organizationId,
        displayName: "Old Agent Only Profile",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      createSandboxProfileFixture({
        id: "sbp_launchable_inactive_connection",
        organizationId: authenticatedSession.organizationId,
        displayName: "Inactive Connection Profile",
        createdAt: "2025-12-31T00:00:00.000Z",
      }),
      createSandboxProfileFixture({
        id: "sbp_launchable_disabled_target",
        organizationId: authenticatedSession.organizationId,
        displayName: "Disabled Target Profile",
        createdAt: "2025-12-30T00:00:00.000Z",
      }),
      createSandboxProfileFixture({
        id: "sbp_launchable_mixed_bindings",
        organizationId: authenticatedSession.organizationId,
        displayName: "Mixed Bindings Profile",
        createdAt: "2025-12-29T00:00:00.000Z",
      }),
    ]);
    await fixture.db.insert(sandboxProfileVersions).values([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_agent",
        version: 1,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_agent",
        version: 2,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_git_only",
        version: 1,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_old_agent_only",
        version: 1,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_old_agent_only",
        version: 2,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_inactive_connection",
        version: 1,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_disabled_target",
        version: 1,
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_launchable_mixed_bindings",
        version: 1,
      }),
    ]);
    await fixture.db.insert(integrationTargets).values([
      createIntegrationTargetFixture({
        targetKey: "openai-sandbox-profiles-launchable",
        variantId: "openai-default",
        enabled: true,
      }),
      createIntegrationTargetFixture({
        targetKey: "openai-sandbox-profiles-launchable-disabled",
        variantId: "openai-disabled",
        enabled: false,
      }),
    ]);
    await fixture.db.insert(integrationConnections).values([
      createIntegrationConnectionFixture({
        id: "icn_sandbox_profiles_launchable",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-sandbox-profiles-launchable",
        displayName: "Sandbox profiles launchable connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_sandbox_profiles_launchable_inactive",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-sandbox-profiles-launchable",
        displayName: "Inactive launchable connection",
        status: IntegrationConnectionStatuses.REVOKED,
      }),
      createIntegrationConnectionFixture({
        id: "icn_sandbox_profiles_launchable_disabled_target",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-sandbox-profiles-launchable-disabled",
        displayName: "Disabled target launchable connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_agent_v2",
        sandboxProfileId: "sbp_launchable_agent",
        sandboxProfileVersion: 2,
        connectionId: "icn_sandbox_profiles_launchable",
        kind: IntegrationBindingKinds.AGENT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_git_only_v1",
        sandboxProfileId: "sbp_launchable_git_only",
        sandboxProfileVersion: 1,
        connectionId: "icn_sandbox_profiles_launchable",
        kind: IntegrationBindingKinds.GIT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_old_agent_v1",
        sandboxProfileId: "sbp_launchable_old_agent_only",
        sandboxProfileVersion: 1,
        connectionId: "icn_sandbox_profiles_launchable",
        kind: IntegrationBindingKinds.AGENT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_old_agent_v2",
        sandboxProfileId: "sbp_launchable_old_agent_only",
        sandboxProfileVersion: 2,
        connectionId: "icn_sandbox_profiles_launchable",
        kind: IntegrationBindingKinds.GIT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_inactive_connection_v1",
        sandboxProfileId: "sbp_launchable_inactive_connection",
        sandboxProfileVersion: 1,
        connectionId: "icn_sandbox_profiles_launchable_inactive",
        kind: IntegrationBindingKinds.AGENT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_disabled_target_v1",
        sandboxProfileId: "sbp_launchable_disabled_target",
        sandboxProfileVersion: 1,
        connectionId: "icn_sandbox_profiles_launchable_disabled_target",
        kind: IntegrationBindingKinds.AGENT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_mixed_bindings_valid_v1",
        sandboxProfileId: "sbp_launchable_mixed_bindings",
        sandboxProfileVersion: 1,
        connectionId: "icn_sandbox_profiles_launchable",
        kind: IntegrationBindingKinds.AGENT,
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_launchable_mixed_bindings_invalid_v1",
        sandboxProfileId: "sbp_launchable_mixed_bindings",
        sandboxProfileVersion: 1,
        connectionId: "icn_sandbox_profiles_launchable_inactive",
        kind: IntegrationBindingKinds.GIT,
      }),
    ]);

    const response = await fixture.request("/v1/sandbox/profiles/launchable", {
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });
    expect(response.status).toBe(200);

    const body = ListLaunchableSandboxProfilesResponseSchema.parse(await response.json());
    expect(body.items).toHaveLength(1);
    expect(body.items).toStrictEqual([
      {
        id: "sbp_launchable_agent",
        organizationId: authenticatedSession.organizationId,
        displayName: "Launchable Agent Profile",
        status: "active",
        latestVersion: 2,
        createdAt: "2026-01-03T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
    ]);
  });
});
