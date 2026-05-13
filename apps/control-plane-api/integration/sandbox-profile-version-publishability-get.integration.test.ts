/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  GetSandboxProfileVersionPublishabilityNotFoundResponseSchema,
  GetSandboxProfileVersionPublishabilityResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});
const itManagedE2BDeployment = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    sandbox: {
      provider: "e2b",
      e2b: {
        apiKey: "integration-managed-e2b-api-key",
      },
    },
  },
});

describe.concurrent("sandbox profile version publishability get integration", () => {
  it("returns publishable true when the draft has an agent runtime and no agent bindings", async ({
    env,
  }) => {
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
        agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.CODEX,
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
      publishable: true,
      issues: [],
    });
  });

  it("returns structured issues for invalid sandbox runtime configuration", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-runtime@example.com",
    });

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

  itManagedE2BDeployment(
    "returns a managed provider issue when Docker is selected on an E2B deployment",
    async ({ env }) => {
      const session = await env.auth.createSession({
        email:
          "integration-new-sandbox-profile-version-publishability-docker-unmanaged@example.com",
      });

      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
        sandboxProfileRow({
          id: "sbp_publishability_docker_unmanaged",
          organizationId: session.organizationId,
          displayName: "Publishability Docker Unmanaged Profile",
          activeVersion: null,
          createdAt: "2026-05-10T00:00:00.000Z",
        }),
      );
      await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
        sandboxProfileVersionRow({
          sandboxProfileId: "sbp_publishability_docker_unmanaged",
          version: 1,
          state: SandboxProfileVersionStates.DRAFT,
          sandboxProvider: SandboxProvider.DOCKER,
        }),
      );
      const response = await env.controlPlaneApi.http.fetch(
        "/v1/sandbox/profiles/sbp_publishability_docker_unmanaged/versions/1/publishability",
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
            code: "SANDBOX_MANAGED_PROVIDER_UNAVAILABLE",
            message: "Managed sandbox provider 'docker' is not configured for this deployment.",
          },
        ],
      });
    },
  );

  it("returns a managed provider issue when E2B is not enabled", async ({ env }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-publishability-e2b-managed-missing@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_e2b_managed_missing",
        organizationId: session.organizationId,
        displayName: "Publishability E2B Managed Missing Profile",
        activeVersion: null,
        createdAt: "2026-05-10T00:05:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_e2b_managed_missing",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.E2B,
        sandboxVcpuCount: 2,
        sandboxMemoryMb: 4096,
      }),
    );
    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_e2b_managed_missing/versions/1/publishability",
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
          code: "SANDBOX_MANAGED_PROVIDER_UNAVAILABLE",
          message:
            "Managed E2B sandbox provider credentials are not configured for this deployment.",
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
