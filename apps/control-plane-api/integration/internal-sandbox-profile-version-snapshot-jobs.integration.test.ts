import {
  sandboxProfiles,
  sandboxProfileVersions,
  sandboxProfileVersionSnapshotJobs,
  SandboxProfileVersionSnapshotJobStates,
  SandboxProfileVersionSnapshotJobTriggers,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH } from "../src/internal/sandbox-profile-version-snapshot-jobs/index.js";
import { it } from "./test-context.js";

describe("internal sandbox profile version snapshot jobs integration", () => {
  it("rejects unauthenticated snapshot job claims", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH}/ssj_internal_snapshot_claim_missing_auth/claim`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workflowRunId: "wf_missing_auth",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("claims a queued snapshot job for execution", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "integration-internal-snapshot-job-claim@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_internal_snapshot_claim",
      organizationId: session.organizationId,
      displayName: "Snapshot Claim",
      activeVersion: null,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_internal_snapshot_claim",
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      publishedAt: "2026-04-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersionSnapshotJobs).values({
      id: "ssj_internal_snapshot_claim",
      sandboxProfileId: "sbp_internal_snapshot_claim",
      sandboxProfileVersion: 1,
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.QUEUED,
    });

    const response = await fixture.request(
      `${INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH}/ssj_internal_snapshot_claim/claim`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          workflowRunId: "wf_internal_snapshot_claim",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });

    const persistedJob = await fixture.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
      columns: {
        state: true,
        workflowRunId: true,
        startedAt: true,
      },
      where: (table, { eq }) => eq(table.id, "ssj_internal_snapshot_claim"),
    });

    expect(persistedJob?.state).toBe(SandboxProfileVersionSnapshotJobStates.RUNNING);
    expect(persistedJob?.workflowRunId).toBe("wf_internal_snapshot_claim");
    expect(persistedJob?.startedAt).not.toBeNull();
  });

  it("marks a running snapshot job succeeded", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "integration-internal-snapshot-job-success@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_internal_snapshot_success",
      organizationId: session.organizationId,
      displayName: "Snapshot Success",
      activeVersion: null,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_internal_snapshot_success",
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      publishedAt: "2026-04-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersionSnapshotJobs).values({
      id: "ssj_internal_snapshot_success",
      sandboxProfileId: "sbp_internal_snapshot_success",
      sandboxProfileVersion: 1,
      workflowRunId: "wf_internal_snapshot_success",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      startedAt: "2026-04-01T00:00:00.000Z",
    });

    const response = await fixture.request(
      `${INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH}/mark-succeeded`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          snapshotJobId: "ssj_internal_snapshot_success",
          workflowRunId: "wf_internal_snapshot_success",
          image: {
            provider: "docker",
            imageId: "sha256:abc123",
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });

    const persistedJob = await fixture.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
      columns: {
        state: true,
        candidateImageProvider: true,
        candidateImageId: true,
        finishedAt: true,
      },
      where: (table, { eq }) => eq(table.id, "ssj_internal_snapshot_success"),
    });

    expect(persistedJob).toEqual({
      state: SandboxProfileVersionSnapshotJobStates.SUCCEEDED,
      candidateImageProvider: "docker",
      candidateImageId: "sha256:abc123",
      finishedAt: expect.any(String),
    });
  });

  it("marks a running snapshot job failed", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "integration-internal-snapshot-job-failure@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_internal_snapshot_failure",
      organizationId: session.organizationId,
      displayName: "Snapshot Failure",
      activeVersion: null,
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_internal_snapshot_failure",
      version: 1,
      state: SandboxProfileVersionStates.PUBLISHED,
      publishedAt: "2026-04-01T00:00:00.000Z",
    });
    await fixture.db.insert(sandboxProfileVersionSnapshotJobs).values({
      id: "ssj_internal_snapshot_failure",
      sandboxProfileId: "sbp_internal_snapshot_failure",
      sandboxProfileVersion: 1,
      workflowRunId: "wf_internal_snapshot_failure",
      trigger: SandboxProfileVersionSnapshotJobTriggers.PUBLISH,
      state: SandboxProfileVersionSnapshotJobStates.RUNNING,
      startedAt: "2026-04-01T00:00:00.000Z",
    });

    const response = await fixture.request(
      `${INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH}/mark-failed`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          snapshotJobId: "ssj_internal_snapshot_failure",
          workflowRunId: "wf_internal_snapshot_failure",
          errorCode: "snapshot_capture_failed",
          errorMessage: "Failed to capture snapshot image.",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
    });

    const persistedJob = await fixture.db.query.sandboxProfileVersionSnapshotJobs.findFirst({
      columns: {
        state: true,
        candidateImageProvider: true,
        candidateImageId: true,
        errorCode: true,
        errorMessage: true,
        finishedAt: true,
      },
      where: (table, { eq }) => eq(table.id, "ssj_internal_snapshot_failure"),
    });

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
