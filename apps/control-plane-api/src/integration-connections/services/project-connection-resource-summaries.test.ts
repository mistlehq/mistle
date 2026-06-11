import { IntegrationConnectionResourceSyncStates } from "@mistle/db/control-plane";
import { GitHubCloudDefinition } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";

import { projectConnectionResourceSummaries } from "./project-connection-resource-summaries.js";

describe("projectConnectionResourceSummaries", () => {
  it("projects never-synced summaries from definition metadata when no state rows exist", () => {
    const result = projectConnectionResourceSummaries({
      definition: GitHubCloudDefinition,
      resourceStates: [],
    });

    expect(result).toEqual([
      {
        kind: "repository",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
      {
        kind: "branch",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
      {
        kind: "user",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
      {
        kind: "team",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
    ]);
  });

  it("projects persisted sync state and count when a state row exists", () => {
    const result = projectConnectionResourceSummaries({
      definition: GitHubCloudDefinition,
      resourceStates: [
        {
          connectionId: "icn_123",
          familyId: "github",
          kind: "repository",
          syncState: IntegrationConnectionResourceSyncStates.READY,
          totalCount: 42,
          lastSyncedAt: "2026-03-09T10:00:00.000Z",
          lastSyncStartedAt: "2026-03-09T09:59:00.000Z",
          lastSyncFinishedAt: "2026-03-09T10:00:00.000Z",
          lastErrorCode: null,
          lastErrorMessage: null,
          createdAt: "2026-03-09T09:59:00.000Z",
          updatedAt: "2026-03-09T10:00:00.000Z",
        },
      ],
    });

    expect(result).toEqual([
      {
        kind: "repository",
        selectionMode: "multi",
        count: 42,
        syncState: IntegrationConnectionResourceSyncStates.READY,
        lastSyncedAt: "2026-03-09T10:00:00.000Z",
      },
      {
        kind: "branch",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
      {
        kind: "user",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
      {
        kind: "team",
        selectionMode: "multi",
        count: 0,
        syncState: IntegrationConnectionResourceSyncStates.NEVER_SYNCED,
      },
    ]);
  });

  it("projects persisted sync failure details for error states", () => {
    const result = projectConnectionResourceSummaries({
      definition: GitHubCloudDefinition,
      resourceStates: [
        {
          connectionId: "icn_123",
          familyId: "github",
          kind: "team",
          syncState: IntegrationConnectionResourceSyncStates.ERROR,
          totalCount: 0,
          lastSyncedAt: null,
          lastSyncStartedAt: "2026-03-09T09:59:00.000Z",
          lastSyncFinishedAt: "2026-03-09T10:00:00.000Z",
          lastErrorCode: "resource_sync_failed",
          lastErrorMessage:
            "GitHub returned a 403 while syncing teams. Reapprove Members read permission.",
          createdAt: "2026-03-09T09:59:00.000Z",
          updatedAt: "2026-03-09T10:00:00.000Z",
        },
      ],
    });

    expect(result).toContainEqual({
      kind: "team",
      selectionMode: "multi",
      count: 0,
      syncState: IntegrationConnectionResourceSyncStates.ERROR,
      lastErrorCode: "resource_sync_failed",
      lastErrorMessage:
        "GitHub returned a 403 while syncing teams. Reapprove Members read permission.",
    });
  });
});
