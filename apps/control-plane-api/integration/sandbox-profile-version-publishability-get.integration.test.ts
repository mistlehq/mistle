/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionPublishabilityNotFoundResponseSchema,
  GetSandboxProfileVersionPublishabilityResponseSchema,
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

describe.concurrent("sandbox profile version publishability get integration", () => {
  it("returns agent binding required when the draft has no agent bindings", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-no-agent@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_001",
        organizationId: session.organizationId,
        displayName: "Publishability No Agent Profile",
        activeVersion: null,
        createdAt: "2026-03-13T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_001/versions/1/publishability",
      {
        headers: {
          cookie: session.cookie,
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
  });

  it("returns structured issues for invalid sandbox runtime configuration", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-runtime@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-publishability-runtime",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_publishability_runtime",
        organizationId: session.organizationId,
        targetKey: "openai-publishability-runtime",
        displayName: "Runtime Issue Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_runtime_001",
        organizationId: session.organizationId,
        displayName: "Publishability Runtime Profile",
        activeVersion: null,
        createdAt: "2026-03-13T00:30:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_runtime_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: "unknown-provider",
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_publishability_runtime",
          sandboxProfileId: "sbp_publishability_runtime_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_runtime",
          kind: IntegrationBindingKinds.AGENT,
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_runtime_001/versions/1/publishability",
      {
        headers: {
          cookie: session.cookie,
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
          code: "INVALID_SANDBOX_PROVIDER",
          message: "Sandbox provider 'unknown-provider' is not supported.",
        },
      ],
    });
  });

  it("returns structured issues for inaccessible, inactive, and disabled agent references", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-issues@example.com",
    });
    const otherOrganizationSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-issues-other-org@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      integrationTargetRow({
        targetKey: "openai-publishability-active",
        variantId: "openai-default",
        enabled: true,
      }),
      integrationTargetRow({
        targetKey: "openai-publishability-disabled",
        variantId: "openai-default",
        enabled: false,
      }),
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_publishability_other_org",
        organizationId: otherOrganizationSession.organizationId,
        targetKey: "openai-publishability-active",
        displayName: "Other Organization Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_publishability_inactive",
        organizationId: session.organizationId,
        targetKey: "openai-publishability-active",
        displayName: "Inactive Connection",
        status: IntegrationConnectionStatuses.ERROR,
      }),
      integrationConnectionRow({
        id: "icn_publishability_disabled_target",
        organizationId: session.organizationId,
        targetKey: "openai-publishability-disabled",
        displayName: "Disabled Target Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_issues_001",
        organizationId: session.organizationId,
        displayName: "Publishability Issues Profile",
        activeVersion: null,
        createdAt: "2026-03-14T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_issues_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_publishability_missing_connection",
          sandboxProfileId: "sbp_publishability_issues_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_other_org",
          kind: IntegrationBindingKinds.AGENT,
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_publishability_inactive_connection",
          sandboxProfileId: "sbp_publishability_issues_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_inactive",
          kind: IntegrationBindingKinds.AGENT,
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_publishability_disabled_target",
          sandboxProfileId: "sbp_publishability_issues_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_disabled_target",
          kind: IntegrationBindingKinds.AGENT,
        }),
      ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_issues_001/versions/1/publishability",
      {
        headers: {
          cookie: session.cookie,
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
  });

  it("returns profile version not draft for published versions", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-published@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_published_001",
        organizationId: session.organizationId,
        displayName: "Published Profile",
        activeVersion: 1,
        createdAt: "2026-03-15T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_published_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-15T00:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_published_001/versions/1/publishability",
      {
        headers: {
          cookie: session.cookie,
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
  });

  it("returns publishable true for a valid draft", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-valid@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-publishability-valid",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_publishability_valid",
        organizationId: session.organizationId,
        targetKey: "openai-publishability-valid",
        displayName: "Valid Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_valid_001",
        organizationId: session.organizationId,
        displayName: "Valid Publishability Profile",
        activeVersion: null,
        createdAt: "2026-03-16T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_valid_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_publishability_valid",
          sandboxProfileId: "sbp_publishability_valid_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_valid",
          kind: IntegrationBindingKinds.AGENT,
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_valid_001/versions/1/publishability",
      {
        headers: {
          cookie: session.cookie,
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
  });

  it("returns 404 when the profile version is outside the authenticated organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_org_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Other Org Publishability Profile",
        activeVersion: null,
        createdAt: "2026-03-17T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_org_b_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
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
  });
});
