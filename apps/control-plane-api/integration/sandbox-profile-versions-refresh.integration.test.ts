/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  AutomationKinds,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  PublishSandboxProfileVersionResponseSchema,
  RefreshSandboxProfileVersionConflictResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { waitForQueuedMaterializeWorkflowInput } from "./helpers/data-plane-workflows.js";
import { sandboxProfileRow, sandboxProfileVersionRow } from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const EmptySandboxRuntimeConfig = {
  sandboxConnectionId: null,
  sandboxProvider: null,
  sandboxResources: null,
};

describe.concurrent("sandbox profile versions refresh integration", () => {
  it("queues manual refresh for a usable published version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-refresh@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_refresh_001",
        organizationId: session.organizationId,
        displayName: "Refresh Profile",
        activeVersion: 2,
        createdAt: "2026-04-24T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_refresh_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-24T00:01:00.000Z",
      }),
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: "sbp_version_refresh_001",
          version: 2,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-04-24T00:02:00.000Z",
        }),
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:refreshable-version-2",
      },
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_refresh_001/versions/2/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PublishSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      version: {
        sandboxProfileId: "sbp_version_refresh_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: true,
        usable: true,
        refreshSchedule: null,
        latestSnapshotJob: {
          id: expect.any(String),
          trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
          state: SandboxProfileVersionSnapshotJobStates.QUEUED,
          errorCode: null,
          errorMessage: null,
          createdAt: expect.any(String),
          startedAt: null,
          finishedAt: null,
        },
      },
      activeVersion: 2,
      snapshotJob: {
        id: expect.any(String),
        trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        errorCode: null,
        errorMessage: null,
        createdAt: expect.any(String),
        startedAt: null,
        finishedAt: null,
      },
    });

    const persistedSnapshotJob =
      await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst({
        where: (table, { eq }) => eq(table.id, responseBody.snapshotJob.id),
      });
    expect(persistedSnapshotJob).toMatchObject({
      id: responseBody.snapshotJob.id,
      sandboxProfileId: "sbp_version_refresh_001",
      sandboxProfileVersion: 2,
      trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
    });

    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "sbp_version_refresh_001"),
    });
    expect(persistedProfile?.activeVersion).toBe(2);

    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: responseBody.snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      snapshotJobId: responseBody.snapshotJob.id,
      sandboxProfileId: "sbp_version_refresh_001",
      sandboxProfileVersion: 2,
      image: {
        kind: "base",
      },
    });
  });

  it("queues publish snapshot retry when the published version does not have a snapshot yet", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-retry-not-usable@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_retry_not_usable_001",
        organizationId: session.organizationId,
        displayName: "Retry Not Usable Profile",
        activeVersion: null,
        createdAt: "2026-04-25T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_retry_not_usable_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-25T00:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_retry_not_usable_001/versions/1/retry-publish-snapshot",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PublishSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      version: {
        sandboxProfileId: "sbp_version_retry_not_usable_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: false,
        usable: false,
        refreshSchedule: null,
        latestSnapshotJob: {
          id: expect.any(String),
          trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
          state: SandboxProfileVersionSnapshotJobStates.QUEUED,
          errorCode: null,
          errorMessage: null,
          createdAt: expect.any(String),
          startedAt: null,
          finishedAt: null,
        },
      },
      activeVersion: null,
      snapshotJob: {
        id: expect.any(String),
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        errorCode: null,
        errorMessage: null,
        createdAt: expect.any(String),
        startedAt: null,
        finishedAt: null,
      },
    });

    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: responseBody.snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      snapshotJobId: responseBody.snapshotJob.id,
      sandboxProfileId: "sbp_version_retry_not_usable_001",
      sandboxProfileVersion: 1,
      image: {
        kind: "base",
      },
    });
  });

  it("returns 409 for manual refresh when the published version does not have a snapshot yet", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-refresh-not-usable@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_refresh_not_usable_001",
        organizationId: session.organizationId,
        displayName: "Refresh Not Usable Profile",
        activeVersion: null,
        createdAt: "2026-04-25T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_refresh_not_usable_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-25T00:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_refresh_not_usable_001/versions/1/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = RefreshSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_USABLE");
  });

  it("queues publish snapshot retry for a failed published version without changing the runnable version immediately", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-retry-publish-snapshot@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_retry_publish_snapshot_001",
        organizationId: session.organizationId,
        displayName: "Retry Publish Snapshot Profile",
        activeVersion: 1,
        createdAt: "2026-04-26T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: "sbp_version_retry_publish_snapshot_001",
          version: 1,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-04-26T00:01:00.000Z",
        }),
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:retry-publish-existing-version-1",
      },
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_retry_publish_snapshot_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-26T00:02:00.000Z",
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: "ssj_version_retry_publish_snapshot_failed_001",
        sandboxProfileId: "sbp_version_retry_publish_snapshot_001",
        sandboxProfileVersion: 2,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.FAILED,
        errorCode: "snapshot_materialization_failed",
        errorMessage: "Snapshot materialization failed.",
        createdAt: "2026-04-26T00:03:00.000Z",
        finishedAt: "2026-04-26T00:04:00.000Z",
      });
    await env.controlPlaneDb.insert(env.controlPlaneTables.automations).values({
      id: "aut_version_retry_publish_snapshot_001",
      organizationId: session.organizationId,
      kind: AutomationKinds.SCHEDULE,
      name: "Retry Publish Snapshot Automation",
      enabled: true,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.automationTargets).values({
      id: "atg_version_retry_publish_snapshot_001",
      automationId: "aut_version_retry_publish_snapshot_001",
      sandboxProfileId: "sbp_version_retry_publish_snapshot_001",
      sandboxProfileVersion: 1,
      primaryRepositoryId: null,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_retry_publish_snapshot_001/versions/2/retry-publish-snapshot",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PublishSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody.version).toMatchObject({
      sandboxProfileId: "sbp_version_retry_publish_snapshot_001",
      version: 2,
      state: SandboxProfileVersionStates.PUBLISHED,
      isActive: false,
      usable: false,
      latestSnapshotJob: {
        id: expect.any(String),
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      },
    });
    expect(responseBody.activeVersion).toBe(1);
    expect(responseBody.snapshotJob.trigger).toBe(SandboxProfileVersionSnapshotJobTriggers.PUBLISH);

    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "sbp_version_retry_publish_snapshot_001"),
    });
    const persistedAutomationTarget = await env.controlPlaneDb.query.automationTargets.findFirst({
      columns: {
        sandboxProfileVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "atg_version_retry_publish_snapshot_001"),
    });

    expect(persistedProfile?.activeVersion).toBe(1);
    expect(persistedAutomationTarget?.sandboxProfileVersion).toBe(1);

    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: responseBody.snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      snapshotJobId: responseBody.snapshotJob.id,
      sandboxProfileId: "sbp_version_retry_publish_snapshot_001",
      sandboxProfileVersion: 2,
      image: {
        kind: "base",
      },
    });
  });

  it("queues publish snapshot retry after a later failed manual refresh attempt", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-retry-after-manual-failure@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_retry_after_manual_failure_001",
        organizationId: session.organizationId,
        displayName: "Retry After Manual Failure Profile",
        activeVersion: 1,
        createdAt: "2026-04-27T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: "sbp_version_retry_after_manual_failure_001",
          version: 1,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-04-27T00:01:00.000Z",
        }),
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:retry-after-manual-existing-version-1",
      },
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_retry_after_manual_failure_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-27T00:02:00.000Z",
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values([
        {
          id: "ssj_retry_after_manual_publish_failed_001",
          sandboxProfileId: "sbp_version_retry_after_manual_failure_001",
          sandboxProfileVersion: 2,
          trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          errorCode: "snapshot_materialization_failed",
          errorMessage: "Snapshot materialization failed.",
          createdAt: "2026-04-27T00:03:00.000Z",
          finishedAt: "2026-04-27T00:04:00.000Z",
        },
        {
          id: "ssj_retry_after_manual_manual_failed_001",
          sandboxProfileId: "sbp_version_retry_after_manual_failure_001",
          sandboxProfileVersion: 2,
          trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
          state: SandboxProfileVersionSnapshotJobStates.FAILED,
          errorCode: "snapshot_materialization_failed",
          errorMessage: "Manual snapshot materialization failed.",
          createdAt: "2026-04-27T00:05:00.000Z",
          finishedAt: "2026-04-27T00:06:00.000Z",
        },
      ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_retry_after_manual_failure_001/versions/2/retry-publish-snapshot",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const responseBody = PublishSandboxProfileVersionResponseSchema.parse(await response.json());
    expect(responseBody.version.latestSnapshotJob).toMatchObject({
      id: expect.any(String),
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
    });
    expect(responseBody.activeVersion).toBe(1);

    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: responseBody.snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      snapshotJobId: responseBody.snapshotJob.id,
      sandboxProfileId: "sbp_version_retry_after_manual_failure_001",
      sandboxProfileVersion: 2,
      image: {
        kind: "base",
      },
    });
  });

  it("returns 409 for manual refresh when the published version has a failed publish snapshot", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-refresh-failed-publish@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_refresh_failed_publish_001",
        organizationId: session.organizationId,
        displayName: "Refresh Failed Publish Profile",
        activeVersion: 1,
        createdAt: "2026-04-28T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: "sbp_version_refresh_failed_publish_001",
          version: 1,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-04-28T00:01:00.000Z",
        }),
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:refresh-failed-publish-existing-version-1",
      },
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_refresh_failed_publish_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-28T00:02:00.000Z",
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: "ssj_version_refresh_failed_publish_001",
        sandboxProfileId: "sbp_version_refresh_failed_publish_001",
        sandboxProfileVersion: 2,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.FAILED,
        errorCode: "snapshot_materialization_failed",
        errorMessage: "Snapshot materialization failed.",
        createdAt: "2026-04-28T00:03:00.000Z",
        finishedAt: "2026-04-28T00:04:00.000Z",
      });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_refresh_failed_publish_001/versions/2/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = RefreshSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_USABLE");

    const queuedRetryJob =
      await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_version_refresh_failed_publish_001"),
            eq(table.sandboxProfileVersion, 2),
            eq(table.state, SandboxProfileVersionSnapshotJobStates.QUEUED),
          ),
      });
    expect(queuedRetryJob).toBeUndefined();
  });

  it("returns 409 when the version is not published", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-refresh-not-published@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_refresh_not_published_001",
        organizationId: session.organizationId,
        displayName: "Refresh Not Published Profile",
        activeVersion: null,
        createdAt: "2026-04-25T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_refresh_not_published_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_refresh_not_published_001/versions/1/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = RefreshSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_USABLE");
  });

  it("returns 409 when a snapshot job is already in progress for the version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-refresh-in-progress@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_refresh_in_progress_001",
        organizationId: session.organizationId,
        displayName: "Refresh In Progress Profile",
        activeVersion: 1,
        createdAt: "2026-04-26T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
      ...sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_refresh_in_progress_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-26T00:01:00.000Z",
      }),
      snapshotImageProvider: "docker",
      snapshotImageId: "sha256:refresh-in-progress",
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs)
      .values({
        id: "ssj_version_refresh_in_progress",
        sandboxProfileId: "sbp_version_refresh_in_progress_001",
        sandboxProfileVersion: 1,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.RUNNING,
        createdAt: "2026-04-26T00:02:00.000Z",
        startedAt: "2026-04-26T00:02:05.000Z",
        workflowRunId: "owfr_snapshot_refresh_in_progress",
      });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_refresh_in_progress_001/versions/1/refresh",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = RefreshSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_SNAPSHOT_IN_PROGRESS");
  });
});
