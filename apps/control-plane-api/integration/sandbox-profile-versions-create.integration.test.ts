/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  CreateSandboxProfileVersionConflictResponseSchema,
  CreateSandboxProfileVersionNotFoundResponseSchema,
  CreateSandboxProfileVersionResponseSchema,
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

const EmptySandboxRuntimeConfig = {
  sandboxConnectionId: null,
  sandboxProvider: null,
  sandboxResources: null,
};

describe.concurrent("sandbox profile versions create integration", () => {
  it("creates the next draft version by cloning the latest version content", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-create@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values([
      integrationTargetRow({
        targetKey: "openai-version-create-latest",
        variantId: "openai-default",
        enabled: true,
      }),
      integrationTargetRow({
        targetKey: "github-version-create-latest",
        variantId: "github-cloud",
        enabled: true,
      }),
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values([
      integrationConnectionRow({
        id: "icn_version_create_latest_agent",
        organizationId: session.organizationId,
        targetKey: "openai-version-create-latest",
        displayName: "Latest Agent Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
      integrationConnectionRow({
        id: "icn_version_create_latest_git",
        organizationId: session.organizationId,
        targetKey: "github-version-create-latest",
        displayName: "Latest Git Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_create_001",
        organizationId: session.organizationId,
        displayName: "Create Draft Profile",
        activeVersion: 1,
        createdAt: "2026-03-10T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_create_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-10T00:01:00.000Z",
        setupScript: "echo active-version-one",
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_create_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-10T00:02:00.000Z",
        setupScript: "echo latest-version-two",
        agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values([
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_version_create_v1_agent",
          sandboxProfileId: "sbp_version_create_001",
          sandboxProfileVersion: 1,
          connectionId: "icn_version_create_latest_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_version_create_v2_agent",
          sandboxProfileId: "sbp_version_create_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_version_create_latest_agent",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
        sandboxProfileVersionIntegrationBindingRow({
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

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_create_001/versions",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(201);
    const responseBody = CreateSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      sandboxProfileId: "sbp_version_create_001",
      version: 3,
      state: SandboxProfileVersionStates.DRAFT,
      defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
      agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.OPENCODE,
      ...EmptySandboxRuntimeConfig,
      isActive: false,
      usable: false,
      refreshSchedule: null,
      latestSnapshotJob: null,
    });

    const persistedDraftVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_create_001"), eq(table.version, 3)),
    });
    expect(persistedDraftVersion?.state).toBe(SandboxProfileVersionStates.DRAFT);
    expect(persistedDraftVersion?.publishedAt).toBeNull();
    expect(persistedDraftVersion?.setupScript).toBe("echo latest-version-two");
    expect(persistedDraftVersion?.defaultPersistenceMode).toBe(
      SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
    );
    expect(persistedDraftVersion?.agentRuntimeId).toBe(
      SandboxProfileVersionAgentRuntimeIds.OPENCODE,
    );

    const persistedDraftBindings =
      await env.controlPlaneDb.query.sandboxProfileVersionIntegrationBindings.findMany({
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
        config: {},
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
  });

  it("returns 409 when the profile already has a draft version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-create-draft-conflict@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_create_conflict_001",
        organizationId: session.organizationId,
        displayName: "Draft Conflict Profile",
        activeVersion: 1,
        createdAt: "2026-03-11T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_create_conflict_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-11T00:01:00.000Z",
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_create_conflict_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_create_conflict_001/versions",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = CreateSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("DRAFT_ALREADY_EXISTS");
  });

  it("returns 404 when the profile is outside the authenticated organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-create-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-create-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_create_org_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Other Org Profile",
        activeVersion: null,
        createdAt: "2026-03-12T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_create_org_b_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
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
  });
});
