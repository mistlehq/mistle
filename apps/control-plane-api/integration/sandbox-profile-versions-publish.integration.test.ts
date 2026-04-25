import {
  integrationConnections,
  integrationTargets,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  PublishSandboxProfileVersionConflictResponseSchema,
  PublishSandboxProfileVersionNotFoundResponseSchema,
  PublishSandboxProfileVersionResponseSchema,
} from "../src/sandbox-profiles/index.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import {
  createIntegrationConnectionFixture,
  createIntegrationTargetFixture,
  createSandboxProfileFixture,
  createSandboxProfileVersionFixture,
  createSandboxProfileVersionIntegrationBindingFixture,
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

describe("sandbox profile versions publish integration", () => {
  it("publishes a draft version and queues initial snapshot materialization", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      controlPlaneBaseUrl: `http://${fixture.config.server.host}:${String(fixture.config.server.port)}`,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_publish_snapshot_job",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    try {
      const authenticatedSession = await fixture.authSession({
        email: "integration-sandbox-profile-version-publish@example.com",
      });

      await fixture.db.insert(integrationTargets).values(
        createIntegrationTargetFixture({
          targetKey: "openai-version-publish-valid",
          variantId: "openai-default",
          enabled: true,
        }),
      );
      await fixture.db.insert(integrationConnections).values(
        createIntegrationConnectionFixture({
          id: "icn_version_publish_valid",
          organizationId: authenticatedSession.organizationId,
          targetKey: "openai-version-publish-valid",
          displayName: "Publish Connection",
          status: IntegrationConnectionStatuses.ACTIVE,
        }),
      );

      await fixture.db.insert(sandboxProfiles).values({
        ...createSandboxProfileFixture({
          id: "sbp_version_publish_001",
          organizationId: authenticatedSession.organizationId,
          displayName: "Publish Profile",
          activeVersion: 1,
          createdAt: "2026-03-18T00:00:00.000Z",
        }),
      });
      await fixture.db.insert(sandboxProfileVersions).values([
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_version_publish_001",
          version: 1,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-03-18T00:01:00.000Z",
        }),
        createSandboxProfileVersionFixture({
          sandboxProfileId: "sbp_version_publish_001",
          version: 2,
          state: SandboxProfileVersionStates.DRAFT,
        }),
      ]);
      await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values(
        createSandboxProfileVersionIntegrationBindingFixture({
          id: "ibd_version_publish_valid",
          sandboxProfileId: "sbp_version_publish_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_version_publish_valid",
          kind: IntegrationBindingKinds.AGENT,
          config: {},
        }),
      );

      const response = await fixture.request(
        "/v1/sandbox/profiles/sbp_version_publish_001/versions/2/publish",
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
          sandboxProfileId: "sbp_version_publish_001",
          version: 2,
          state: SandboxProfileVersionStates.PUBLISHED,
          isActive: false,
          usable: false,
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
        activeVersion: 1,
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

      const persistedVersion = await fixture.db.query.sandboxProfileVersions.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.sandboxProfileId, "sbp_version_publish_001"), eq(table.version, 2)),
      });
      expect(persistedVersion?.state).toBe(SandboxProfileVersionStates.PUBLISHED);
      expect(persistedVersion?.publishedAt).not.toBeNull();

      const persistedProfile = await fixture.db.query.sandboxProfiles.findFirst({
        columns: {
          activeVersion: true,
        },
        where: (table, { eq }) => eq(table.id, "sbp_version_publish_001"),
      });
      expect(persistedProfile?.activeVersion).toBe(1);

      const persistedSnapshotJob =
        await fixture.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
          where: (table, { eq }) => eq(table.id, responseBody.snapshotJob.id),
        });
      expect(persistedSnapshotJob).toMatchObject({
        id: responseBody.snapshotJob.id,
        sandboxProfileId: "sbp_version_publish_001",
        sandboxProfileVersion: 2,
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      });

      const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
        dataPlaneDbPool: dataPlaneFixture.dbPool,
        workflowNamespaceId: fixture.config.workflow.namespaceId,
        snapshotJobId: responseBody.snapshotJob.id,
      });
      expect(queuedWorkflowInput).toMatchObject({
        snapshotJobId: responseBody.snapshotJob.id,
        sandboxProfileId: "sbp_version_publish_001",
        sandboxProfileVersion: 2,
        image: {
          kind: "base",
        },
      });
    } finally {
      await dataPlaneFixture.stop();
    }
  }, 60_000);

  it("returns 409 when the selected version is not a draft", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish-not-draft@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_not_draft_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publish Not Draft Profile",
        activeVersion: 1,
        createdAt: "2026-03-19T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_not_draft_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-19T00:01:00.000Z",
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_not_draft_001/versions/1/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PublishSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_DRAFT");
  }, 60_000);

  it("returns 409 when the draft is not publishable", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish-not-publishable@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_not_publishable_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Publishability Failure Profile",
        activeVersion: null,
        createdAt: "2026-03-20T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_not_publishable_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_not_publishable_001/versions/1/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PublishSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_PUBLISHABLE");
  }, 60_000);

  it("returns 404 when the version does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-profile-version-publish-missing-version@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      ...createSandboxProfileFixture({
        id: "sbp_version_publish_missing_001",
        organizationId: authenticatedSession.organizationId,
        displayName: "Missing Publish Version Profile",
        activeVersion: null,
        createdAt: "2026-03-21T00:00:00.000Z",
      }),
    });
    await fixture.db.insert(sandboxProfileVersions).values(
      createSandboxProfileVersionFixture({
        sandboxProfileId: "sbp_version_publish_missing_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await fixture.request(
      "/v1/sandbox/profiles/sbp_version_publish_missing_001/versions/2/publish",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = PublishSandboxProfileVersionNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  }, 60_000);
});
