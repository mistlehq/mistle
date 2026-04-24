import {
  integrationConnections,
  integrationTargets,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionPublishabilityNotFoundResponseSchema,
  GetSandboxProfileVersionPublishabilityResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createIntegrationConnectionFixture,
  createIntegrationTargetFixture,
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile version publishability get integration", () => {
  it("returns agent binding required when the draft has no agent bindings", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-no-agent@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_publishability_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publishability No Agent Profile",
        activeVersion: null,
        createdAt: "2026-03-13T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_publishability_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_publishability_001/versions/1/publishability",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionPublishabilityResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      publishable: false,
      issues: [
        {
          code: "AGENT_BINDING_REQUIRED",
          message:
            "Sandbox profile version must declare at least one agent binding before it can be published.",
        },
      ],
    });
  }, 60_000);

  it("returns structured issues for inaccessible, inactive, and disabled agent references", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-issues@example.com",
    });
    const otherOrganizationSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-issues-other-org@example.com",
    });

    await fixture.db.insert(integrationTargets).values([
      createIntegrationTargetFixture({
        targetKey: "openai-publishability-active",
        variantId: "openai-default",
        enabled: true,
      }),
      createIntegrationTargetFixture({
        targetKey: "openai-publishability-disabled",
        variantId: "openai-default",
        enabled: false,
      }),
    ]);
    await fixture.db.insert(integrationConnections).values([
      createIntegrationConnectionFixture({
        id: "icn_publishability_other_org",
        organizationId: otherOrganizationSession.organizationId,
        targetKey: "openai-publishability-active",
        displayName: "Other Organization Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_publishability_inactive",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-publishability-active",
        displayName: "Inactive Connection",
        status: IntegrationConnectionStatuses.ERROR,
      }),
      createIntegrationConnectionFixture({
        id: "icn_publishability_disabled_target",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-publishability-disabled",
        displayName: "Disabled Target Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_publishability_issues_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publishability Issues Profile",
        activeVersion: null,
        createdAt: "2026-03-14T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_publishability_issues_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_publishability_missing_connection",
        sandboxProfileId: "sbp_publishability_issues_001",
        sandboxProfileVersion: 1,
        connectionId: "icn_publishability_other_org",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_publishability_inactive_connection",
        sandboxProfileId: "sbp_publishability_issues_001",
        sandboxProfileVersion: 1,
        connectionId: "icn_publishability_inactive",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_publishability_disabled_target",
        sandboxProfileId: "sbp_publishability_issues_001",
        sandboxProfileVersion: 1,
        connectionId: "icn_publishability_disabled_target",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
    ]);

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_publishability_issues_001/versions/1/publishability",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionPublishabilityResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      publishable: false,
      issues: [
        {
          code: "TARGET_DISABLED",
          message:
            "Agent binding 'ibd_publishability_disabled_target' references disabled target 'openai-publishability-disabled'.",
          bindingId: "ibd_publishability_disabled_target",
          connectionId: "icn_publishability_disabled_target",
          targetKey: "openai-publishability-disabled",
        },
        {
          code: "CONNECTION_NOT_ACTIVE",
          message:
            "Agent binding 'ibd_publishability_inactive_connection' references connection 'icn_publishability_inactive' that is not active.",
          bindingId: "ibd_publishability_inactive_connection",
          connectionId: "icn_publishability_inactive",
        },
        {
          code: "INVALID_BINDING_CONNECTION_REFERENCE",
          message:
            "Agent binding 'ibd_publishability_missing_connection' references connection 'icn_publishability_other_org' that is missing or inaccessible.",
          bindingId: "ibd_publishability_missing_connection",
          connectionId: "icn_publishability_other_org",
        },
      ],
    });
  }, 60_000);

  it("returns profile version not draft for published versions", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-published@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_publishability_published_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Published Profile",
        activeVersion: 1,
        createdAt: "2026-03-15T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_publishability_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-15T00:01:00.000Z",
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_publishability_published_001/versions/1/publishability",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionPublishabilityResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      publishable: false,
      issues: [
        {
          code: "PROFILE_VERSION_NOT_DRAFT",
          message: "Sandbox profile version '1' is not a draft.",
        },
      ],
    });
  }, 60_000);

  it("returns publishable true for a valid draft", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-valid@example.com",
    });

    await fixture.db.insert(integrationTargets).values(
      createIntegrationTargetFixture({
        targetKey: "openai-publishability-valid",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await fixture.db.insert(integrationConnections).values(
      createIntegrationConnectionFixture({
        id: "icn_publishability_valid",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-publishability-valid",
        displayName: "Valid Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_publishability_valid_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Valid Publishability Profile",
        activeVersion: null,
        createdAt: "2026-03-16T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_publishability_valid_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values(
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_publishability_valid",
        sandboxProfileId: "sbp_publishability_valid_001",
        sandboxProfileVersion: 1,
        connectionId: "icn_publishability_valid",
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_publishability_valid_001/versions/1/publishability",
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = GetSandboxProfileVersionPublishabilityResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody).toEqual({
      publishable: true,
      issues: [],
    });
  }, 60_000);

  it("returns 404 when the profile version is outside the authenticated organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publishability-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_publishability_org_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Other Org Publishability Profile",
        activeVersion: null,
        createdAt: "2026-03-17T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_publishability_org_b_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_publishability_org_b_001/versions/1/publishability",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = GetSandboxProfileVersionPublishabilityNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_NOT_FOUND");
  }, 60_000);
});
