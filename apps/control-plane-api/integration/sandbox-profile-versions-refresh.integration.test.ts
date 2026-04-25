import {
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  sandboxProfiles,
  sandboxProfileVersionSnapshotJobs,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  PublishSandboxProfileVersionResponseSchema,
  RefreshSandboxProfileVersionConflictResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import {
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
} from "./helpers/sandbox-profiles.js";
import { it } from "./test-context.js";

const WorkflowRunPersistTimeoutMs = 30_000;
const WorkflowRunPersistPollIntervalMs = 100;
const MaterializeWorkflowName = "data-plane.sandbox-profile-version-snapshots.materialize";

const MaterializeWorkflowRunInputSchema = z.looseObject({
  snapshotJobId: z.string().min(1),
  sandboxProfileId: z.string().min(1),
  sandboxProfileVersion: z.number().int().min(1),
  image: z
    .object({
      imageId: z.string().min(1),
      createdAt: z.iso.datetime().optional(),
      kind: z.literal("base"),
    })
    .strict(),
});

async function waitForQueuedMaterializeWorkflowInput(input: {
  dataPlaneDbPool: DisposableDataPlaneRuntime["dbPool"];
  workflowNamespaceId: string;
  snapshotJobId: string;
}) {
  const deadline = Date.now() + WorkflowRunPersistTimeoutMs;

  while (Date.now() < deadline) {
    const result = await input.dataPlaneDbPool.query<{ input: unknown }>(
      `
        select input
        from data_plane_openworkflow.workflow_runs
        where
          namespace_id = $1
          and workflow_name = $2
          and input->>'snapshotJobId' = $3
        order by created_at desc
        limit 1
      `,
      [input.workflowNamespaceId, MaterializeWorkflowName, input.snapshotJobId],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return MaterializeWorkflowRunInputSchema.parse(row.input);
    }

    await systemSleeper.sleep(WorkflowRunPersistPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for queued snapshot materialization workflow input for snapshot job '${input.snapshotJobId}'.`,
  );
}

describe("sandbox profile versions refresh integration", () => {
  it("queues manual refresh for a usable published version", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_refresh_snapshot_job",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-refresh@example.com",
      });

      await fixture.db.insert(sandboxProfiles).values({
        ...createSandboxProfileFixture({
          id: "sbp_version_refresh_001",
          organizationId: authenticatedSession.organizationId,
          displayName: "Refresh Profile",
          activeVersion: 2,
          createdAt: "2026-04-24T00:00:00.000Z",
        }),
      });
      await fixture.db.insert(sandboxProfileVersions).values([
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_version_refresh_001",
          version: 1,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-04-24T00:01:00.000Z",
        }),
        {
          ...createSandboxProfileVersionFixture({
            sandboxProfileId: "sbp_version_refresh_001",
            version: 2,
            state: SandboxProfileVersionStates.PUBLISHED,
            publishedAt: "2026-04-24T00:02:00.000Z",
          }),
          snapshotImageProvider: "docker",
          snapshotImageId: "sha256:refreshable-version-2",
        },
      ]);

      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_version_refresh_001/versions/2/refresh",
        {
          method: "POST",
          headers: {
            cookie: authenticatedSession.cookie,
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
          isActive: true,
          usable: true,
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
        await fixture.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
          where: (table, { eq }) => eq(table.id, responseBody.snapshotJob.id),
        });
      expect(persistedSnapshotJob).toMatchObject({
        id: responseBody.snapshotJob.id,
        sandboxProfileId: "sbp_version_refresh_001",
        sandboxProfileVersion: 2,
        trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      });

      const persistedProfile = await fixture.db.query.sandboxProfiles.findFirst({
        columns: {
          activeVersion: true,
        },
        where: (table, { eq }) => eq(table.id, "sbp_version_refresh_001"),
      });
      expect(persistedProfile?.activeVersion).toBe(2);

      const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
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
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("returns 409 when the version is not yet usable", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-refresh-not-usable@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_refresh_not_usable_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Refresh Not Usable Profile",
        activeVersion: null,
        createdAt: "2026-04-25T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_refresh_not_usable_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-25T00:01:00.000Z",
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_refresh_not_usable_001/versions/1/refresh",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = RefreshSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_USABLE");
  }, 60_000);

  it("returns 409 when a snapshot job is already in progress for the version", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-refresh-in-progress@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_refresh_in_progress_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Refresh In Progress Profile",
        activeVersion: 1,
        createdAt: "2026-04-26T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      ...createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_refresh_in_progress_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-04-26T00:01:00.000Z",
      }),
      snapshotImageProvider: "docker",
      snapshotImageId: "sha256:refresh-in-progress",
    });
    await fixture.db.insert(sandboxProfileVersionSnapshotJobs).values({
      id: "ssj_version_refresh_in_progress",
      sandboxProfileId: "sbp_version_refresh_in_progress_001",
      sandboxProfileVersion: 1,
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      createdAt: "2026-04-26T00:02:00.000Z",
      startedAt: "2026-04-26T00:02:05.000Z",
      workflowRunId: "owfr_snapshot_refresh_in_progress",
    });

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_refresh_in_progress_001/versions/1/refresh",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = RefreshSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_SNAPSHOT_IN_PROGRESS");
  }, 60_000);
});
