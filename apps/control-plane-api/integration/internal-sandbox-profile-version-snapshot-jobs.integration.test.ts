/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  TriggerKinds,
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

  it("promotes refresh snapshots without changing the active version or trigger targets", async ({
    env,
  }) => {
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
    await seedTriggerTarget(env, {
      organizationId: session.organizationId,
      triggerId: "aut_internal_snapshot_refresh_target",
      targetId: "atg_internal_snapshot_refresh_target",
      sandboxProfileId: "sbp_internal_snapshot_refresh_success",
      sandboxProfileVersion: 3,
      enabled: true,
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
    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_refresh_target"),
    ).resolves.toBe(3);
  });

  it("advances all trigger targets for a profile after a publish snapshot succeeds", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-advance-trigger-targets@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_advance_targets",
      jobId: "ssj_internal_snapshot_advance_targets",
      workflowRunId: "wf_internal_snapshot_advance_targets",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: 1,
      profileVersion: 2,
    });
    await seedTriggerTarget(env, {
      organizationId: session.organizationId,
      triggerId: "aut_internal_snapshot_advance_targets_one",
      targetId: "atg_internal_snapshot_advance_targets_one",
      sandboxProfileId: "sbp_internal_snapshot_advance_targets",
      sandboxProfileVersion: 1,
      enabled: true,
    });
    await seedTriggerTarget(env, {
      organizationId: session.organizationId,
      triggerId: "aut_internal_snapshot_advance_targets_two",
      triggerKind: TriggerKinds.WEBHOOK,
      targetId: "atg_internal_snapshot_advance_targets_two",
      sandboxProfileId: "sbp_internal_snapshot_advance_targets",
      sandboxProfileVersion: 7,
      enabled: false,
    });
    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_advance_targets_other",
      jobId: "ssj_internal_snapshot_advance_targets_other",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
      activeVersion: 4,
      profileVersion: 4,
    });
    await seedTriggerTarget(env, {
      organizationId: session.organizationId,
      triggerId: "aut_internal_snapshot_advance_targets_other",
      targetId: "atg_internal_snapshot_advance_targets_other",
      sandboxProfileId: "sbp_internal_snapshot_advance_targets_other",
      sandboxProfileVersion: 4,
      enabled: true,
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_advance_targets",
      action: "succeed",
      body: {
        workflowRunId: "wf_internal_snapshot_advance_targets",
        image: {
          provider: "docker",
          imageId: "sha256:advance-targets",
        },
      },
    });

    expect(response.status).toBe(200);

    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_advance_targets_one"),
    ).resolves.toBe(2);
    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_advance_targets_two"),
    ).resolves.toBe(2);
    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_advance_targets_other"),
    ).resolves.toBe(4);
  });

  it("does not move trigger targets backward when an older publish snapshot succeeds after a newer version is active", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-older-publish-after-newer-active@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_older_publish",
      jobId: "ssj_internal_snapshot_older_publish",
      workflowRunId: "wf_internal_snapshot_older_publish",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: 3,
      profileVersion: 2,
    });
    await seedTriggerTarget(env, {
      organizationId: session.organizationId,
      triggerId: "aut_internal_snapshot_older_publish",
      targetId: "atg_internal_snapshot_older_publish",
      sandboxProfileId: "sbp_internal_snapshot_older_publish",
      sandboxProfileVersion: 3,
      enabled: true,
    });

    const response = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_older_publish",
      action: "succeed",
      body: {
        workflowRunId: "wf_internal_snapshot_older_publish",
        image: {
          provider: "docker",
          imageId: "sha256:older-publish",
        },
      },
    });

    expect(response.status).toBe(200);

    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_older_publish"),
    ).resolves.toBe(3);
  });

  it("keeps trigger targets on the newer version when publish snapshots complete out of order", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-snapshot-job-out-of-order-publish@example.com",
    });

    await seedSnapshotJob(env, {
      organizationId: session.organizationId,
      profileId: "sbp_internal_snapshot_out_of_order_publish",
      jobId: "ssj_internal_snapshot_out_of_order_publish_v2",
      workflowRunId: "wf_internal_snapshot_out_of_order_publish_v2",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      activeVersion: 1,
      profileVersion: 2,
    });
    await seedSnapshotJobForExistingProfile(env, {
      profileId: "sbp_internal_snapshot_out_of_order_publish",
      jobId: "ssj_internal_snapshot_out_of_order_publish_v3",
      workflowRunId: "wf_internal_snapshot_out_of_order_publish_v3",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      profileVersion: 3,
    });
    await seedTriggerTarget(env, {
      organizationId: session.organizationId,
      triggerId: "aut_internal_snapshot_out_of_order_publish",
      targetId: "atg_internal_snapshot_out_of_order_publish",
      sandboxProfileId: "sbp_internal_snapshot_out_of_order_publish",
      sandboxProfileVersion: 1,
      enabled: true,
    });

    const newerResponse = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_out_of_order_publish_v3",
      action: "succeed",
      body: {
        workflowRunId: "wf_internal_snapshot_out_of_order_publish_v3",
        image: {
          provider: "docker",
          imageId: "sha256:out-of-order-publish-v3",
        },
      },
    });

    expect(newerResponse.status).toBe(200);
    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_out_of_order_publish"),
    ).resolves.toBe(3);
    await expect(
      readSnapshotProfile(env, {
        profileId: "sbp_internal_snapshot_out_of_order_publish",
      }),
    ).resolves.toMatchObject({
      activeVersion: 3,
    });

    const olderResponse = await snapshotJobRequest(env, {
      jobId: "ssj_internal_snapshot_out_of_order_publish_v2",
      action: "succeed",
      body: {
        workflowRunId: "wf_internal_snapshot_out_of_order_publish_v2",
        image: {
          provider: "docker",
          imageId: "sha256:out-of-order-publish-v2",
        },
      },
    });

    expect(olderResponse.status).toBe(200);
    await expect(
      readTriggerTargetVersion(env, "atg_internal_snapshot_out_of_order_publish"),
    ).resolves.toBe(3);
    await expect(
      readSnapshotProfile(env, {
        profileId: "sbp_internal_snapshot_out_of_order_publish",
      }),
    ).resolves.toMatchObject({
      activeVersion: 3,
    });
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
    profileVersion?: number;
  },
): Promise<void> {
  const profileVersion = input.profileVersion ?? 1;
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
    id: input.profileId,
    organizationId: input.organizationId,
    displayName: "Snapshot Job Profile",
    activeVersion: input.activeVersion ?? null,
  });
  await seedSnapshotJobForExistingProfile(env, {
    profileId: input.profileId,
    jobId: input.jobId,
    trigger: input.trigger,
    state: input.state,
    ...(input.workflowRunId === undefined ? {} : { workflowRunId: input.workflowRunId }),
    ...(input.existingSnapshotImageId === undefined
      ? {}
      : { existingSnapshotImageId: input.existingSnapshotImageId }),
    profileVersion,
  });
}

async function seedSnapshotJobForExistingProfile(
  env: IntegrationTestEnvironment,
  input: {
    profileId: string;
    jobId: string;
    trigger:
      | typeof SandboxProfileVersionSnapshotJobTriggers.PUBLISH
      | typeof SandboxProfileVersionSnapshotJobTriggers.MANUAL_REFRESH;
    state:
      | typeof SandboxProfileVersionSnapshotJobStates.QUEUED
      | typeof SandboxProfileVersionSnapshotJobStates.RUNNING;
    workflowRunId?: string;
    existingSnapshotImageId?: string;
    profileVersion: number;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values({
    sandboxProfileId: input.profileId,
    version: input.profileVersion,
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
    sandboxProfileVersion: input.profileVersion,
    workflowRunId: input.workflowRunId,
    trigger: input.trigger,
    state: input.state,
    ...(input.state === SandboxProfileVersionSnapshotJobStates.RUNNING
      ? { startedAt: "2026-04-01T00:00:00.000Z" }
      : {}),
  });
}

async function seedTriggerTarget(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    triggerId: string;
    triggerKind?: typeof TriggerKinds.SCHEDULE | typeof TriggerKinds.WEBHOOK;
    targetId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    enabled: boolean;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
    id: input.triggerId,
    organizationId: input.organizationId,
    kind: input.triggerKind ?? TriggerKinds.SCHEDULE,
    name: "Snapshot Target Trigger",
    enabled: input.enabled,
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.triggerTargets).values({
    id: input.targetId,
    triggerId: input.triggerId,
    sandboxProfileId: input.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    primaryRepositoryId: null,
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
) {
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

async function readTriggerTargetVersion(
  env: IntegrationTestEnvironment,
  targetId: string,
): Promise<number | undefined> {
  const target = await env.controlPlaneDb.query.triggerTargets.findFirst({
    columns: {
      sandboxProfileVersion: true,
    },
    where: (table, { eq }) => eq(table.id, targetId),
  });

  return target?.sandboxProfileVersion;
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
