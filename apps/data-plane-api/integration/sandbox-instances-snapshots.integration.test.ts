import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import {
  sandboxInstanceSnapshots,
  SandboxSnapshotArtifactKinds,
  sandboxInstances,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { describe, expect } from "vitest";

import { it } from "./test-context.js";

describe("sandboxInstances.getLatestSnapshot integration", () => {
  it("returns the latest non-deleted snapshot for the source sandbox instance", async ({
    fixture,
  }) => {
    const client = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });

    const organizationId = "org_dp_api_snapshot_latest";
    const sourceInstanceId = "sbi_dp_api_snapshot_latest";
    await fixture.db.insert(sandboxInstances).values({
      id: sourceInstanceId,
      organizationId,
      sandboxProfileId: "sbp_dp_api_snapshot_latest",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: "provider-sandbox-snapshot-latest",
      status: SandboxInstanceStatuses.STOPPED,
      startedByKind: "system",
      startedById: "aru_dp_api_snapshot_latest",
      source: "webhook",
    });

    await fixture.db.insert(sandboxInstanceSnapshots).values([
      {
        id: "sbs_dp_api_snapshot_latest_old",
        organizationId,
        sourceInstanceId,
        artifactKind: SandboxSnapshotArtifactKinds.PROVIDER_IMAGE,
        artifactRef: {
          imageId: "registry.example/snapshot-old@sha256:111",
          kind: "snapshot",
          createdAt: "2026-03-07T00:00:00.000Z",
        },
        createdAt: "2026-03-07T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: "sbs_dp_api_snapshot_latest_deleted",
        organizationId,
        sourceInstanceId,
        artifactKind: SandboxSnapshotArtifactKinds.PROVIDER_IMAGE,
        artifactRef: {
          imageId: "registry.example/snapshot-deleted@sha256:222",
          kind: "snapshot",
          createdAt: "2026-03-07T00:10:00.000Z",
        },
        createdAt: "2026-03-07T00:10:00.000Z",
        deletedAt: "2026-03-07T00:11:00.000Z",
      },
      {
        id: "sbs_dp_api_snapshot_latest_new",
        organizationId,
        sourceInstanceId,
        artifactKind: SandboxSnapshotArtifactKinds.PROVIDER_IMAGE,
        artifactRef: {
          imageId: "registry.example/snapshot-new@sha256:333",
          kind: "snapshot",
          createdAt: "2026-03-07T00:20:00.000Z",
        },
        createdAt: "2026-03-07T00:20:00.000Z",
        deletedAt: null,
      },
    ]);

    const latestSnapshot = await client.getLatestSandboxInstanceSnapshot({
      organizationId,
      sourceInstanceId,
    });

    expect(latestSnapshot).toEqual({
      snapshotId: "sbs_dp_api_snapshot_latest_new",
      sourceInstanceId,
      createdAt: "2026-03-07T00:20:00.000Z",
      image: {
        imageId: "registry.example/snapshot-new@sha256:333",
        kind: "snapshot",
        createdAt: "2026-03-07T00:20:00.000Z",
      },
    });
  }, 60_000);

  it("returns null when no non-deleted snapshot exists for the source sandbox instance", async ({
    fixture,
  }) => {
    const client = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });

    const latestSnapshot = await client.getLatestSandboxInstanceSnapshot({
      organizationId: "org_dp_api_snapshot_none",
      sourceInstanceId: "sbi_dp_api_snapshot_none",
    });

    expect(latestSnapshot).toBeNull();
  }, 60_000);
});
