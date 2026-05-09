/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  ListSandboxProfileVersionsResponseSchema,
  NotFoundResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const EmptySandboxRuntimeConfig = {
  sandboxConnectionId: null,
  sandboxProvider: null,
  sandboxResources: null,
};

describe.concurrent("sandbox profile versions list integration", () => {
  it("returns profile versions ordered by version descending", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-versions-list@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_versions_list_001",
        organizationId: session.organizationId,
        displayName: "Versions List Profile",
        activeVersion: 2,
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_versions_list_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
      }),
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: "sbp_versions_list_001",
          version: 2,
          state: SandboxProfileVersionStates.PUBLISHED,
        }),
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:version-2-usable",
      },
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_versions_list_001",
        version: 3,
        state: SandboxProfileVersionStates.DRAFT,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values([
        {
          id: "ssj_versions_list_v1_publish",
          sandboxProfileId: "sbp_versions_list_001",
          sandboxProfileVersion: 1,
          trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
          state: SandboxProfileVersionSnapshotJobStates.RUNNING,
          createdAt: "2026-03-01T00:02:00.000Z",
          startedAt: "2026-03-01T00:02:05.000Z",
        },
        {
          id: "ssj_versions_list_v2_refresh_failed",
          sandboxProfileId: "sbp_versions_list_001",
          sandboxProfileVersion: 2,
          trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          errorCode: "snapshot_refresh_failed",
          errorMessage: "Snapshot refresh failed.",
          createdAt: "2026-03-01T00:03:00.000Z",
          startedAt: "2026-03-01T00:03:05.000Z",
          finishedAt: "2026-03-01T00:03:25.000Z",
        },
      ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_versions_list_001/versions",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = ListSandboxProfileVersionsResponseSchema.parse(await response.json());
    expect(responseBody.versions).toEqual([
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 3,
        state: SandboxProfileVersionStates.DRAFT,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.PERSISTENT,
        ...EmptySandboxRuntimeConfig,
        isActive: false,
        usable: false,
        refreshSchedule: null,
        latestSnapshotJob: null,
      },
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: true,
        usable: true,
        refreshSchedule: null,
        latestSnapshotJob: {
          id: "ssj_versions_list_v2_refresh_failed",
          trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          errorCode: "snapshot_refresh_failed",
          errorMessage: "Snapshot refresh failed.",
          createdAt: "2026-03-01 00:03:00+00",
          startedAt: "2026-03-01 00:03:05+00",
          finishedAt: "2026-03-01 00:03:25+00",
        },
      },
      {
        sandboxProfileId: "sbp_versions_list_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: false,
        usable: false,
        refreshSchedule: null,
        latestSnapshotJob: {
          id: "ssj_versions_list_v1_publish",
          trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
          state: SandboxProfileVersionSnapshotJobStates.RUNNING,
          errorCode: null,
          errorMessage: null,
          createdAt: "2026-03-01 00:02:00+00",
          startedAt: "2026-03-01 00:02:05+00",
          finishedAt: null,
        },
      },
    ]);
  });

  it("marks all versions inactive when the profile has not published yet", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-versions-list-draft-only@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_versions_list_draft_only_001",
        organizationId: session.organizationId,
        displayName: "Draft Only Profile",
        activeVersion: null,
        createdAt: "2026-03-02T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_versions_list_draft_only_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_versions_list_draft_only_001/versions",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = ListSandboxProfileVersionsResponseSchema.parse(await response.json());
    expect(responseBody.versions).toEqual([
      {
        sandboxProfileId: "sbp_versions_list_draft_only_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: false,
        usable: false,
        refreshSchedule: null,
        latestSnapshotJob: null,
      },
    ]);
  });

  it("returns failed initial materialization state for published versions without a usable snapshot", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-versions-list-failed-materialization@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_versions_list_failed_materialization_001",
        organizationId: session.organizationId,
        displayName: "Failed Materialization Profile",
        activeVersion: null,
        createdAt: "2026-03-03T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_versions_list_failed_materialization_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
      }),
    );
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: "ssj_versions_list_failed_materialization_publish",
        sandboxProfileId: "sbp_versions_list_failed_materialization_001",
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.FAILED,
        errorCode: "snapshot_materialization_failed",
        errorMessage: "Snapshot materialization failed.",
        createdAt: "2026-03-03T00:01:00.000Z",
        startedAt: "2026-03-03T00:01:05.000Z",
        finishedAt: "2026-03-03T00:01:30.000Z",
      });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_versions_list_failed_materialization_001/versions",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = ListSandboxProfileVersionsResponseSchema.parse(await response.json());
    expect(responseBody.versions).toEqual([
      {
        sandboxProfileId: "sbp_versions_list_failed_materialization_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: false,
        usable: false,
        refreshSchedule: null,
        latestSnapshotJob: {
          id: "ssj_versions_list_failed_materialization_publish",
          trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          errorCode: "snapshot_materialization_failed",
          errorMessage: "Snapshot materialization failed.",
          createdAt: "2026-03-03 00:01:00+00",
          startedAt: "2026-03-03 00:01:05+00",
          finishedAt: "2026-03-03 00:01:30+00",
        },
      },
    ]);
  });

  it("returns 404 when profile is outside authenticated organization", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-versions-list-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-profile-versions-list-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_versions_list_org_b_001",
        organizationId: secondOrgSession.organizationId,
        displayName: "Org B Profile",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_versions_list_org_b_001",
        version: 1,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_versions_list_org_b_001/versions",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = NotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("PROFILE_NOT_FOUND");
  });
});
