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
  CreateSandboxProfileVersionConflictResponseSchema,
  CreateSandboxProfileVersionNotFoundResponseSchema,
  CreateSandboxProfileVersionResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createIntegrationConnectionFixture,
  createIntegrationTargetFixture,
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

describe("sandbox profile versions create integration", () => {
  it("creates the next draft version by cloning the latest version content", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-create@example.com",
    });

    await fixture.db.insert(integrationTargets).values([
      createIntegrationTargetFixture({
        targetKey: "openai-version-create-latest",
        variantId: "openai-default",
        enabled: true,
      }),
      createIntegrationTargetFixture({
        targetKey: "github-version-create-latest",
        variantId: "github-cloud",
        enabled: true,
      }),
    ]);
    await fixture.db.insert(integrationConnections).values([
      createIntegrationConnectionFixture({
        id: "icn_version_create_latest_agent",
        organizationId: authenticatedSession.organizationId,
        targetKey: "openai-version-create-latest",
        displayName: "Latest Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      createIntegrationConnectionFixture({
        id: "icn_version_create_latest_git",
        organizationId: authenticatedSession.organizationId,
        targetKey: "github-version-create-latest",
        displayName: "Latest Git Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_create_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Create Draft Profile",
        activeVersion: 1,
        createdAt: "2026-03-10T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_create_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-10T00:01:00.000Z",
        setupScript: "echo active-version-one",
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_create_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-10T00:02:00.000Z",
        setupScript: "echo latest-version-two",
      }),
    ]);
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values([
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_version_create_v1_agent",
        sandboxProfileId: "sbp_version_create_001",
        sandboxProfileVersion: 1,
        connectionId: "icn_version_create_latest_agent",
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
        },
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_version_create_v2_agent",
        sandboxProfileId: "sbp_version_create_001",
        sandboxProfileVersion: 2,
        connectionId: "icn_version_create_latest_agent",
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
        },
      }),
      createSandboxProfileVersionIntegrationBindingFixture({
        id: "ibd_version_create_v2_git",
        sandboxProfileId: "sbp_version_create_001",
        sandboxProfileVersion: 2,
        connectionId: "icn_version_create_latest_git",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle"],
        },
      }),
    ]);

    const response = await fixture.request("/v1/sandbox/profiles/sbp_version_create_001/versions", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
      },
    });

    expect(response.status).toBe(201);
    const responseBody = CreateSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      sandboxProfileId: "sbp_version_create_001",
      version: 3,
      state: SandboxProfileVersionStates.DRAFT,
      isActive: false,
      usable: false,
      latestSnapshotJob: null,
    });

    const persistedDraftVersion = await fixture.db.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_create_001"), eq(table.version, 3)),
    });
    expect(persistedDraftVersion?.state).toBe(SandboxProfileVersionStates.DRAFT);
    expect(persistedDraftVersion?.publishedAt).toBeNull();
    expect(persistedDraftVersion?.setupScript).toBe("echo latest-version-two");

    const persistedDraftBindings =
      await fixture.db.query.sandboxProfileVersionIntegrationBindings.findMany({
        columns: {
          id: true,
          connectionId: true,
          kind: true,
          config: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_version_create_001"),
            eq(table.sandboxProfileVersion, 3),
          ),
        orderBy: (table, { asc }) => [asc(table.kind), asc(table.id)],
      });

    expect(
      persistedDraftBindings.map((binding) => ({
        connectionId: binding.connectionId,
        kind: binding.kind,
        config: binding.config,
      })),
    ).toEqual([
      {
        connectionId: "icn_version_create_latest_agent",
        kind: IntegrationBindingKinds.AGENT,
        config: {
          runtime: {
            runtimeId: "codex",
            config: {},
          },
        },
      },
      {
        connectionId: "icn_version_create_latest_git",
        kind: IntegrationBindingKinds.GIT,
        config: {
          repositories: ["mistlehq/mistle"],
        },
      },
    ]);
    expect(
      persistedDraftBindings.some(
        (binding) =>
          binding.id === "ibd_version_create_v2_agent" ||
          binding.id === "ibd_version_create_v2_git",
      ),
    ).toBe(false);
  }, 60_000);

  it("returns 409 when the profile already has a draft version", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-create-draft-conflict@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_create_conflict_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Draft Conflict Profile",
        activeVersion: 1,
        createdAt: "2026-03-11T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values([
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_create_conflict_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-11T00:01:00.000Z",
      }),
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_create_conflict_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    ]);

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_create_conflict_001/versions",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = CreateSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("DRAFT_ALREADY_EXISTS");
  }, 60_000);

  it("returns 404 when the profile is outside the authenticated organization", async ({
    fixture,
  }) => {
    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-create-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-create-org-b@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_create_org_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Other Org Profile",
        activeVersion: null,
        createdAt: "2026-03-12T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_create_org_b_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_create_org_b_001/versions",
      {
        method: "POST",
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = CreateSandboxProfileVersionNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_NOT_FOUND");
  }, 60_000);
});
