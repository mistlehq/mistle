/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionAgentRuntimeIds,
  SandboxProfileVersionDefaultPersistenceModes,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { SandboxProvider } from "@mistle/sandbox";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  PublishSandboxProfileVersionConflictResponseSchema,
  PublishSandboxProfileVersionNotFoundResponseSchema,
  PublishSandboxProfileVersionResponseSchema,
} from "../src/sandbox-profiles/index.js";
import { waitForQueuedMaterializeWorkflowInput } from "./helpers/data-plane-workflows.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const EmptySandboxRuntimeConfig = {
  agentRuntimeId: SandboxProfileVersionAgentRuntimeIds.CODEX,
  sandboxConnectionId: null,
  sandboxProvider: SandboxProvider.DOCKER,
  sandboxResources: null,
};

describe.concurrent("sandbox profile versions publish integration", () => {
  it("publishes a draft version and queues initial snapshot materialization", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publish@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-version-publish-valid",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_version_publish_valid",
        organizationId: session.organizationId,
        targetKey: "openai-version-publish-valid",
        displayName: "Publish Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_publish_001",
        organizationId: session.organizationId,
        displayName: "Publish Profile",
        activeVersion: 1,
        createdAt: "2026-03-18T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-18T00:01:00.000Z",
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_001",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_version_publish_valid",
          sandboxProfileId: "sbp_version_publish_001",
          sandboxProfileVersion: 2,
          connectionId: "icn_version_publish_valid",
          kind: IntegrationBindingKinds.AGENT,
        }),
      );

    const scheduleResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_001/versions/2/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Draft refresh",
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );
    expect(scheduleResponse.status).toBe(200);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_001/versions/2/publish",
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
        sandboxProfileId: "sbp_version_publish_001",
        version: 2,
        state: SandboxProfileVersionStates.PUBLISHED,
        defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceModes.EPHEMERAL,
        ...EmptySandboxRuntimeConfig,
        isActive: false,
        usable: false,
        maintenanceScript: null,
        refreshSchedule: {
          scheduleId: expect.any(String),
          name: "Draft refresh",
          cronExpression: "0 9 * * *",
          timezone: "Asia/Singapore",
          enabled: true,
          nextScheduledAt: expect.any(String),
        },
        latestSnapshotJob: {
          id: expect.any(String),
          sandboxInstanceId: expect.any(String),
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
        sandboxInstanceId: expect.any(String),
        trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
        state: SandboxProfileVersionSnapshotJobStates.QUEUED,
        errorCode: null,
        errorMessage: null,
        createdAt: expect.any(String),
        startedAt: null,
        finishedAt: null,
      },
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        state: true,
        publishedAt: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_version_publish_001"), eq(table.version, 2)),
    });
    expect(persistedVersion?.state).toBe(SandboxProfileVersionStates.PUBLISHED);
    expect(persistedVersion?.publishedAt).not.toBeNull();

    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "sbp_version_publish_001"),
    });
    expect(persistedProfile?.activeVersion).toBe(1);

    const persistedSnapshotJob =
      await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst({
        where: (table, { eq }) => eq(table.id, responseBody.snapshotJob.id),
      });
    expect(persistedSnapshotJob).toMatchObject({
      id: responseBody.snapshotJob.id,
      sandboxInstanceId: responseBody.snapshotJob.sandboxInstanceId,
      sandboxProfileId: "sbp_version_publish_001",
      sandboxProfileVersion: 2,
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
    });

    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: responseBody.snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      snapshotJobId: responseBody.snapshotJob.id,
      sandboxInstanceId: responseBody.snapshotJob.sandboxInstanceId,
      sandboxProfileId: "sbp_version_publish_001",
      sandboxProfileVersion: 2,
      image: {
        kind: "base",
      },
      snapshotPreparationScriptKind: "setup",
    });
  });

  it("copies the previous active version maintenance script and refresh schedule when publishing", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publish-copy-maintenance@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_publish_copy_maintenance",
        organizationId: session.organizationId,
        displayName: "Publish Copy Maintenance Profile",
        activeVersion: 1,
        createdAt: "2026-05-15T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      {
        ...sandboxProfileVersionRow({
          sandboxProfileId: "sbp_version_publish_copy_maintenance",
          version: 1,
          state: SandboxProfileVersionStates.PUBLISHED,
          publishedAt: "2026-05-15T00:01:00.000Z",
          maintenanceScript: "echo maintain previous",
        }),
        snapshotImageProvider: "docker",
        snapshotImageId: "sha256:publish-copy-maintenance-v1",
      },
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_copy_maintenance",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        maintenanceScript: "echo draft should not replace previous",
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    ]);

    const scheduleResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_copy_maintenance/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Existing active refresh",
          cronExpression: "15 7 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );
    expect(scheduleResponse.status).toBe(200);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_copy_maintenance/versions/2/publish",
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
      sandboxProfileId: "sbp_version_publish_copy_maintenance",
      version: 2,
      maintenanceScript: "echo maintain previous",
      refreshSchedule: {
        name: "Existing active refresh",
        cronExpression: "15 7 * * *",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: expect.any(String),
      },
    });

    const persistedPublishedVersion =
      await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
        columns: {
          maintenanceScript: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_version_publish_copy_maintenance"),
            eq(table.version, 2),
          ),
      });
    expect(persistedPublishedVersion?.maintenanceScript).toBe("echo maintain previous");

    const copiedTarget =
      await env.controlPlaneDb.query.sandboxProfileSnapshotRefreshScheduleTargets.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_version_publish_copy_maintenance"),
            eq(table.sandboxProfileVersion, 2),
          ),
      });
    if (copiedTarget === undefined) {
      throw new Error("Expected copied refresh schedule target for published version.");
    }

    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: responseBody.snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      image: {
        kind: "base",
      },
      snapshotPreparationScriptKind: "setup",
    });
  });

  it("updates the draft refresh schedule when copying previous active settings during publish", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publish-update-draft-schedule@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_publish_update_draft_schedule",
        organizationId: session.organizationId,
        displayName: "Publish Update Draft Schedule Profile",
        activeVersion: 1,
        createdAt: "2026-05-15T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_update_draft_schedule",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-05-15T00:01:00.000Z",
        maintenanceScript: "echo active maintenance",
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_update_draft_schedule",
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    ]);

    const activeScheduleResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_update_draft_schedule/versions/1/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Active refresh",
          cronExpression: "30 8 * * *",
          timezone: "Asia/Singapore",
        }),
      },
    );
    expect(activeScheduleResponse.status).toBe(200);

    const draftScheduleResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_update_draft_schedule/versions/2/refresh-schedule",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          name: "Draft refresh",
          cronExpression: "45 9 * * *",
          timezone: "UTC",
        }),
      },
    );
    expect(draftScheduleResponse.status).toBe(200);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_update_draft_schedule/versions/2/publish",
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
      maintenanceScript: "echo active maintenance",
      refreshSchedule: {
        name: "Active refresh",
        cronExpression: "30 8 * * *",
        timezone: "Asia/Singapore",
      },
    });

    const draftVersionTargets =
      await env.controlPlaneDb.query.sandboxProfileSnapshotRefreshScheduleTargets.findMany({
        columns: {
          scheduleId: true,
        },
        where: (table, { and, eq }) =>
          and(
            eq(table.sandboxProfileId, "sbp_version_publish_update_draft_schedule"),
            eq(table.sandboxProfileVersion, 2),
          ),
      });
    expect(draftVersionTargets).toHaveLength(1);
  });

  it("returns 409 when the selected version is not a draft", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publish-not-draft@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_publish_not_draft_001",
        organizationId: session.organizationId,
        displayName: "Publish Not Draft Profile",
        activeVersion: 1,
        createdAt: "2026-03-19T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_not_draft_001",
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-03-19T00:01:00.000Z",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_not_draft_001/versions/1/publish",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PublishSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_DRAFT");
  });

  it("returns 409 when the draft has invalid runtime configuration", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publish-not-publishable@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_publish_not_publishable_001",
        organizationId: session.organizationId,
        displayName: "Publishability Failure Profile",
        activeVersion: null,
        createdAt: "2026-03-20T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_not_publishable_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: "unknown-provider",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_not_publishable_001/versions/1/publish",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(409);
    const responseBody = PublishSandboxProfileVersionConflictResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_PUBLISHABLE");
  });

  it("returns 404 when the version does not exist", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-profile-version-publish-missing-version@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: "sbp_version_publish_missing_001",
        organizationId: session.organizationId,
        displayName: "Missing Publish Version Profile",
        activeVersion: null,
        createdAt: "2026-03-21T00:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: "sbp_version_publish_missing_001",
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/profiles/sbp_version_publish_missing_001/versions/2/publish",
      {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const responseBody = PublishSandboxProfileVersionNotFoundResponseSchema.parse(
      await response.json(),
    );
    expect(responseBody.code).toBe("PROFILE_VERSION_NOT_FOUND");
  });
});
