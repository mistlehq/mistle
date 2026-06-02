import { describe, expect, it } from "vitest";

import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  formatSnapshotTimestamp,
  resolveRetainedSnapshotOperationState,
  resolveSnapshotPanelState,
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
          operationId: null,
          sandboxInstanceId: null,
        },
      }),
    ).toEqual({
      operationId: "ssj_snapshot_001",
      sandboxInstanceId: "sbi_snapshot_001",
    });
  });
});

describe("resolveSnapshotPanelState", () => {
  it("uses the version publish time when a usable copied snapshot has no snapshot job history", () => {
    const state = resolveSnapshotPanelState(
      {
        sandboxProfileId: "sbp_copied_snapshot",
        version: 1,
        state: "published",
        publishedAt: "2026-05-21T09:30:00.000Z",
        agentRuntimeId: "codex",
        gitCommitSigningIntegrationConnectionId: null,
        mistleMcpEnabled: false,
        mistleMcpApiKeyId: null,
        sandboxProvider: "docker",
        sandboxConnectionId: null,
        sandboxResources: null,
        maintenanceScript: null,
        isActive: true,
        usable: true,
        refreshSchedule: null,
        latestSnapshotJob: null,
      } satisfies SandboxProfileVersion,
      1,
    );

    expect(state).toEqual({
      kind: "ready",
      latestSnapshotCreatedAt: "2026-05-21T09:30:00.000Z",
      operationId: null,
      sandboxInstanceId: null,
    });
  });
});

describe("formatSnapshotTimestamp", () => {
  it("formats the latest snapshot timestamp with the local timezone offset", () => {
    const formattedTimestamp = formatSnapshotTimestamp("2026-05-21T09:30:00.000Z");

    expect(formattedTimestamp).not.toContain("2026-05-21T09:30");
    expect(formattedTimestamp).toMatch(/GMT(?:[+-]\d+)?/u);
  });
});
