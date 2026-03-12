// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";

describe("IntegrationConnectionDetailView", () => {
  afterEach(() => {
    cleanup();
  });

  it("switches the selected connection and exposes refresh actions", () => {
    let selectedConnectionId: string | null = null;
    let refreshedKind: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            displayName: "Engineering GitHub",
            status: "active",
            authMethodLabel: "OAuth",
            createdAt: "2026-03-03T00:00:00.000Z",
            updatedAt: "2026-03-11T04:30:00.000Z",
            resources: [
              {
                kind: "repositories",
                selectionMode: "multi",
                count: 41,
                syncState: "ready",
                lastSyncedAt: "2026-03-11T04:25:00.000Z",
              },
            ],
          },
          {
            id: "icn_github_archive",
            displayName: "Archive Mirror",
            status: "error",
            authMethodLabel: "API key",
            createdAt: "2026-02-14T00:00:00.000Z",
            updatedAt: "2026-03-10T10:15:00.000Z",
            resources: [
              {
                kind: "repositories",
                selectionMode: "multi",
                count: 0,
                syncState: "error",
                lastErrorMessage: "GitHub returned a 403 while reading repository visibility.",
              },
            ],
          },
        ]}
        onRefreshResource={({ kind }) => {
          refreshedKind = kind;
        }}
        onSelectConnection={(connectionId) => {
          selectedConnectionId = connectionId;
        }}
        selectedConnectionId="icn_github_archive"
        targetDisplayName="GitHub"
        targetKey="github"
      />,
    );

    expect(
      screen.getByText("GitHub returned a 403 while reading repository visibility."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Engineering GitHub/ }));
    expect(selectedConnectionId).toBe("icn_github_primary");
    fireEvent.click(screen.getByRole("button", { name: "Refresh resources" }));
    expect(refreshedKind).toBe("repositories");
  });

  it("renders an empty state when no connections are available", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[]}
        onSelectConnection={() => {}}
        selectedConnectionId={null}
        targetDisplayName="GitHub"
        targetKey="github"
      />,
    );

    expect(screen.getByText("No connections found for this target.")).toBeTruthy();
  });
});
