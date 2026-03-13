import { describe, expect, it } from "vitest";

import {
  formatConnectionStatusLabel,
  formatResourceMetadata,
  formatSyncStateLabel,
} from "./integration-connection-detail-formatters.js";

describe("integration connection detail formatters", () => {
  it("formats connection status labels", () => {
    expect(formatConnectionStatusLabel("active")).toBe("Active");
    expect(formatConnectionStatusLabel("error")).toBe("Error");
    expect(formatConnectionStatusLabel("revoked")).toBe("Revoked");
  });

  it("formats sync state labels", () => {
    expect(formatSyncStateLabel("never-synced")).toBe("Never synced");
    expect(formatSyncStateLabel("syncing")).toBe("Syncing");
    expect(formatSyncStateLabel("ready")).toBe("Ready");
    expect(formatSyncStateLabel("error")).toBe("Sync failed");
  });

  it("formats resource metadata across readiness states", () => {
    expect(formatResourceMetadata({ syncState: "never-synced" })).toBe(
      "Resources have not been synced yet.",
    );
    expect(
      formatResourceMetadata({
        syncState: "syncing",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      }),
    ).toContain("Last synced");
    expect(formatResourceMetadata({ syncState: "syncing" })).toBe(
      "Resources have not been synced yet.",
    );
    expect(
      formatResourceMetadata({
        syncState: "ready",
        lastSyncedAt: "2026-03-11T04:25:00.000Z",
      }),
    ).toContain("Last synced");
    expect(
      formatResourceMetadata({
        syncState: "error",
        lastErrorMessage: "Token expired.",
      }),
    ).toBe("Token expired.");
  });
});
