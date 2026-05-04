/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH } from "../src/internal/sandbox-profile-version-snapshot-jobs/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("internal sandbox profile version snapshot jobs integration", () => {
  it("rejects unauthenticated snapshot job claims", async ({ env }) => {
    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_claim_missing_auth",
      action: "claim",
      authenticated: false,
      body: {
        workflowRunId: "wf_missing_auth",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("claims a queued snapshot job for execution", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-claim@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_claim",
      jobId: "ssj_internal_snapshot_claim",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_claim",
      action: "claim",
      body: {
        workflowRunId: "wf_internal_snapshot_claim",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });

    const persistedJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
      {
        columns: {
          state: true,
          workflowRunId: true,
          startedAt: true,
        },
        where: (table, { eq }) => eq(table.id, "ssj_internal_snapshot_claim"),
      },
    );

    expect(persistedJob?.state).toBe(SandboxProfileVersionSnapshotJobStates.RUNNING);
    expect(persistedJob?.workflowRunId).toBe("wf_internal_snapshot_claim");
    expect(persistedJob?.startedAt).not.toBeNull();
  });

  it("marks a running publish snapshot job succeeded and activates the version", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-success@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_success",
      jobId: "ssj_internal_snapshot_success",
      workflowRunId: "wf_internal_snapshot_success",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: null,
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_success",
      action: "succeed",
      body: {
        workflowRunId: "wf_internal_snapshot_success",
        image: {
          provider: "docker",
          imageId: "sha256:abc123",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });

    const persistedJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
      {
        columns: {
          state: true,
          candidateImageProvider: true,
          candidateImageId: true,
          finishedAt: true,
        },
        where: (table, { eq }) => eq(table.id, "ssj_internal_snapshot_success"),
      },
    );
    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        snapshotImageProvider: true,
        snapshotImageId: true,
      },
      where: (table, { and, eq }) =>
        and(eq(table.sandboxProfileId, "sbp_internal_snapshot_success"), eq(table.version, 1)),
    });
    const persistedProfile = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
      columns: {
        activeVersion: true,
      },
      where: (table, { eq }) => eq(table.id, "sbp_internal_snapshot_success"),
    });

    expect(persistedJob).toEqual({
      state: SandboxProfileVersionSnapshotJobStates.SUCCEEDED,
      candidateImageProvider: "docker",
      candidateImageId: "sha256:abc123",
      finishedAt: expect.any(String),
    });
    expect(persistedVersion).toEqual({
      snapshotImageProvider: "docker",
      snapshotImageId: "sha256:abc123",
    });
    expect(persistedProfile?.activeVersion).toBe(1);
  });

  it("promotes refresh snapshots without changing the active version", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-refresh-success@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_refresh_success",
      jobId: "ssj_internal_snapshot_refresh_success",
      workflowRunId: "wf_internal_snapshot_refresh_success",
      trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: 3,
      existingSnapshotImageId: "sha256:old-snapshot",
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_refresh_success",
      action: "succeed",
      body: {
        workflowRunId: "wf_internal_snapshot_refresh_success",
        image: {
          provider: "docker",
          imageId: "sha256:new-snapshot",
        },
      },
    });

    expect(response.status).toBe(200);

    const persistedVersion = await readSnapshotVersion(env, {
      profileId: "sbp_internal_snapshot_refresh_success",
    });
    const persistedProfile = await readSnapshotProfile(env, {
      profileId: "sbp_internal_snapshot_refresh_success",
    });

    expect(persistedVersion).toEqual({
      snapshotImageProvider: "docker",
      snapshotImageId: "sha256:new-snapshot",
    });
    expect(persistedProfile?.activeVersion).toBe(3);
  });

  it("keeps the current snapshot and active version when a refresh job fails", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-refresh-failure@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_refresh_failure",
      jobId: "ssj_internal_snapshot_refresh_failure",
      workflowRunId: "wf_internal_snapshot_refresh_failure",
      trigger: SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: 2,
      existingSnapshotImageId: "sha256:stable-snapshot",
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_refresh_failure",
      action: "fail",
      body: {
        workflowRunId: "wf_internal_snapshot_refresh_failure",
        errorCode: "snapshot_capture_failed",
        errorMessage: "Failed to capture refreshed snapshot image.",
      },
    });

    expect(response.status).toBe(200);

    const persistedVersion = await readSnapshotVersion(env, {
      profileId: "sbp_internal_snapshot_refresh_failure",
    });
    const persistedProfile = await readSnapshotProfile(env, {
      profileId: "sbp_internal_snapshot_refresh_failure",
    });

    expect(persistedVersion).toEqual({
      snapshotImageProvider: "docker",
      snapshotImageId: "sha256:stable-snapshot",
    });
    expect(persistedProfile?.activeVersion).toBe(2);
  });

  it("marks a running snapshot job failed", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-failure@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_failure",
      jobId: "ssj_internal_snapshot_failure",
      workflowRunId: "wf_internal_snapshot_failure",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: null,
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_failure",
      action: "fail",
      body: {
        workflowRunId: "wf_internal_snapshot_failure",
        errorCode: "snapshot_capture_failed",
        errorMessage: "Failed to capture snapshot image.",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });

    const persistedJob = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findFirst(
      {
        columns: {
          state: true,
          candidateImageProvider: true,
          candidateImageId: true,
          errorCode: true,
          errorMessage: true,
          finishedAt: true,
        },
        where: (table, { eq }) => eq(table.id, "ssj_internal_snapshot_failure"),
      },
    );

    expect(persistedJob).toEqual({
      state: SandboxProfileVersionSnapshotJobStates.FAILED,
      candidateImageProvider: null,
      candidateImageId: null,
      errorCode: "snapshot_capture_failed",
      errorMessage: "Failed to capture snapshot image.",
      finishedAt: expect.any(String),
    });
  });
});

async function seedSnapshotJob(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    profileId: string;
    jobId: string;
    trigger:
      | typeof SandboxProfileVersionSnapshotJobTriggers.PUBLISH
      | typeof SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH;
    state:
      | typeof SandboxProfileVersionSnapshotJobStates.QUEUED
      | typeof SandboxProfileVersionSnapshotJobStates.RUNNING;
    workflowRunId?: string;
    activeVersion?: number | null;
    existingSnapshotImageId?: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: "Snapshot Job Profile",
    activeVersion: input.activeVersion ?? null,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: 1,
    state: SandboxProfileVersionStates.PUBLISHED,
    publishedAt: "2026-04-01T00:00:00.000Z",
    ...(input.existingSnapshotImageId === undefined
      ? {}
      : {
          snapshotImageProvider: "docker",
          snapshotImageId: input.existingSnapshotImageId,
        }),
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersionSnapshotJobs).values({
    id: input.jobId,
    sandboxProfileId: input.profileId,
    sandboxProfileVersion: 1,
    workflowRunId: input.workflowRunId,
    trigger: input.trigger,
    state: input.state,
    ...(input.state === SandboxProfileVersionSnapshotJobStates.RUNNING
      ? { startedAt: "2026-04-01T00:00:00.000Z" }
      : {}),
  });
}

async function snapshotJobRequest(
  env: IntegrationTestEnvironment,
  input: {
    jobId: string;
    action: "claim" | "succeed" | "fail";
    body: Record<string, unknown>;
    authenticated?: boolean;
  },
): Promise<Response> {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH}/${input.jobId}/${input.action}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.authenticated === false
          ? {}
          : { [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "integration-new-internal-service-token" }),
      },
      body: JSON.stringify(input.body),
    },
  );
}

async function readSnapshotVersion(
  env: IntegrationTestEnvironment,
  input: {
    profileId: string;
  },
) {
  return await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
    columns: {
      snapshotImageProvider: true,
      snapshotImageId: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, 1)),
  });
}

async function readSnapshotProfile(
  env: IntegrationTestEnvironment,
  input: {
    profileId: string;
  },
) {
  return await env.controlPlaneDb.query.sandboxProfiles.findFirst({
    columns: {
      activeVersion: true,
    },
    where: (table, { eq }) => eq(table.id, input.profileId),
  });
}
