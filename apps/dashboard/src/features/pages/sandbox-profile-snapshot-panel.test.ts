import { describe, expect, it } from "vitest";

import {
  resolveRetainedSnapshotOperationState,
  type SnapshotPanelState,
} from "./sandbox-profile-snapshot-panel.js";

describe("resolveRetainedSnapshotOperationState", () => {
  it("updates a queued snapshot progress record with the completed snapshot sandbox id", () => {
    const creatingState: SnapshotPanelState = {
      kind: "creating",
      operationId: "ssj_snapshot_001",
      publishedVersion: 2,
      runnableVersion: 1,
      sandboxInstanceId: null,
    };
    const readyState: SnapshotPanelState = {
      kind: "ready",
      latestSnapshotCreatedAt: "2026-05-13T10:00:00.000Z",
      operationId: "ssj_snapshot_001",
      sandboxInstanceId: "sbi_snapshot_001",
    };

    const queuedProgressState = resolveRetainedSnapshotOperationState({
      retainedState: null,
      state: creatingState,
    });

    expect(
      resolveRetainedSnapshotOperationState({
        retainedState: queuedProgressState,
        state: readyState,
      }),
    ).toEqual({
      operationId: "ssj_snapshot_001",
      sandboxInstanceId: "sbi_snapshot_001",
    });
  });

  it("keeps the last snapshot progress record after terminal states without operation identity", () => {
    expect(
      resolveRetainedSnapshotOperationState({
        retainedState: {
          operationId: "ssj_snapshot_001",
          sandboxInstanceId: "sbi_snapshot_001",
        },
        state: {
          kind: "refresh-error",
          latestSnapshotCreatedAt: null,
          message: "Snapshot materialization failed.",
        },
      }),
    ).toEqual({
      operationId: "ssj_snapshot_001",
      sandboxInstanceId: "sbi_snapshot_001",
    });
  });
});
