/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
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

  it("returns a skills source issue when selected skills have not been loaded", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-skills-unloaded@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_skills_unloaded",
        organizationId: session.organizationId,
        displayName: "Publishability Skills Unloaded Profile",
        activeVersion: null,
        createdAt: "2026-06-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_skills_unloaded",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
        skillsConfig: {
          originUrl: "https://github.com/acme/skills.git",
          selectedSkills: [],
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "github-publishability-skills-unloaded",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_publishability_skills_unloaded",
        organizationId: session.organizationId,
        targetKey: "github-publishability-skills-unloaded",
        displayName: "GitHub",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "spb_publishability_skills_unloaded",
          sandboxProfileId: "sbp_publishability_skills_unloaded",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_skills_unloaded",
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: ["acme/skills"],
          },
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_skills_unloaded/versions/1/publishability",
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
          code: "SKILLS_SOURCE_NOT_LOADED",
          message: "Load skills before publishing this sandbox profile.",
        },
      ],
    });
  });

  it("allows a loaded skills source even when it is not bound to the draft", async ({ env }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-publishability-public-skills-bound-cache@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_public_skills_bound_cache",
        organizationId: session.organizationId,
        displayName: "Publishability Public Skills Bound Cache Profile",
        activeVersion: null,
        createdAt: "2026-06-03T00:03:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_public_skills_bound_cache",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
        skillsConfig: {
          originUrl: "https://github.com/acme/skills.git",
          selectedSkills: [
            {
              name: "available",
              relativePath: ".agents/skills/available",
            },
          ],
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.skillsSourceRepos).values({
      id: "skr_publishability_public_skills_bound_cache",
      organizationId: session.organizationId,
      originUrl: "https://github.com/acme/skills.git",
      commitSha: "dddddddddddddddddddddddddddddddddddddddd",
      skills: [
        {
          name: "available",
          description: "Available skill.",
          relativePath: ".agents/skills/available",
        },
      ],
      lastSyncedAt: "2026-06-03T00:04:00.000Z",
      createdAt: "2026-06-03T00:04:00.000Z",
      updatedAt: "2026-06-03T00:04:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_public_skills_bound_cache/versions/1/publishability",
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

  it("returns a skills source issue when a loaded non-public source is not bound to the draft", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email:
        "integration-new-sandbox-profile-version-publishability-non-public-skills-unbound@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_non_public_skills_unbound",
        organizationId: session.organizationId,
        displayName: "Publishability Non-Public Skills Unbound Profile",
        activeVersion: null,
        createdAt: "2026-06-03T00:07:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_non_public_skills_unbound",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
        skillsConfig: {
          originUrl: "https://ghe.example.com/acme/skills.git",
          selectedSkills: [
            {
              name: "available",
              relativePath: ".agents/skills/available",
            },
          ],
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.skillsSourceRepos).values({
      id: "skr_publishability_non_public_skills_unbound",
      organizationId: session.organizationId,
      originUrl: "https://ghe.example.com/acme/skills.git",
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      skills: [
        {
          name: "available",
          description: "Available skill.",
          relativePath: ".agents/skills/available",
        },
      ],
      lastSyncedAt: "2026-06-03T00:08:00.000Z",
      createdAt: "2026-06-03T00:08:00.000Z",
      updatedAt: "2026-06-03T00:08:00.000Z",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_non_public_skills_unbound/versions/1/publishability",
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
          code: "SKILLS_SOURCE_NOT_BOUND",
          message:
            "Add this repository to the Git integration bindings before publishing this sandbox profile.",
        },
      ],
    });
  });

  it("returns a selected skills issue when a saved skill was renamed upstream", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publishability-skills-missing@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_publishability_skills_missing",
        organizationId: session.organizationId,
        displayName: "Publishability Skills Missing Profile",
        activeVersion: null,
        createdAt: "2026-06-03T00:05:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_publishability_skills_missing",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
        skillsConfig: {
          originUrl: "https://github.com/acme/skills.git",
          selectedSkills: [
            {
              name: "removed",
              relativePath: ".agents/skills/available",
            },
          ],
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.skillsSourceRepos).values({
      id: "skr_publishability_skills_missing",
      organizationId: session.organizationId,
      originUrl: "https://github.com/acme/skills.git",
      commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      skills: [
        {
          name: "available",
          description: "Available skill.",
          relativePath: ".agents/skills/available",
        },
      ],
      lastSyncedAt: "2026-06-03T00:06:00.000Z",
      createdAt: "2026-06-03T00:06:00.000Z",
      updatedAt: "2026-06-03T00:06:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "github-publishability-skills-missing",
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_publishability_skills_missing",
        organizationId: session.organizationId,
        targetKey: "github-publishability-skills-missing",
        displayName: "GitHub",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "spb_publishability_skills_missing",
          sandboxProfileId: "sbp_publishability_skills_missing",
          sandboxProfileVersion: 1,
          connectionId: "icn_publishability_skills_missing",
          kind: IntegrationBindingKinds.GIT,
          config: {
            repositories: ["acme/skills"],
          },
        }),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_publishability_skills_missing/versions/1/publishability",
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
          code: "SELECTED_SKILLS_NOT_FOUND",
          message: "Remove skills that are no longer found before publishing this sandbox profile.",
        },
      ],
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
