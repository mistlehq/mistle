// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";

describe("IntegrationConnectionDetailView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders stacked connections and exposes refresh actions", () => {
    let refreshedKind: string | null = null;
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            displayName: "Engineering GitHub",
            status: "active",
            authMethodLabel: "GitHub App installation",
            resources: [
              {
                kind: "repositories",
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
            resources: [
              {
                kind: "repositories",
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
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
                errorMessage: null,
                isLoading: false,
                items: [
                  {
                    id: "repo_1",
                    familyId: "github",
                    kind: "repositories",
                    handle: "mistle/dashboard",
                    displayName: "mistle/dashboard",
                    status: "accessible",
                    metadata: {},
                  },
                ],
                kind: "repositories",
              },
            ],
          ])
        }
      />,
    );

    expect(
      screen.getAllByText("GitHub returned a 403 while reading repository visibility."),
    ).toHaveLength(1);
    expect(screen.getByText("Engineering GitHub")).toBeTruthy();
    expect(screen.getByText("Archive Mirror")).toBeTruthy();
    expect(screen.getByText("mistle/dashboard")).toBeTruthy();
    const [refreshButton] = screen.getAllByRole("button", { name: "Refresh repositories" });
    if (refreshButton === undefined) {
      throw new Error("Expected a refresh repositories button.");
    }
    fireEvent.click(refreshButton);
    expect(refreshedKind).toBe("repositories");
  });

  it("renders an empty state when no connections are available", () => {
    render(<IntegrationConnectionDetailView connections={[]} />);

    expect(screen.getByText("No connections found for this target.")).toBeTruthy();
  });

  it("disables refresh controls for resources already marked as refreshing", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            displayName: "Engineering GitHub",
            status: "active",
            authMethodLabel: "GitHub App installation",
            resources: [
              {
                kind: "repositories",
                count: 41,
                syncState: "syncing",
                isRefreshing: true,
              },
            ],
          },
        ]}
        onRefreshResource={() => {}}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: "Refresh repositories" });
    expect(refreshButton).toHaveProperty("disabled", true);
  });

  it("starts title editing for the clicked connection", () => {
    let editingConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            displayName: "Engineering GitHub",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
          {
            id: "icn_github_archive",
            displayName: "Archive Mirror",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
        ]}
        titleEditor={{
          connectionId: null,
          draftValue: "",
          isEditing: false,
          onCancel: () => {},
          onCommit: () => {},
          onDraftValueChange: () => {},
          onEditStart: (connectionId) => {
            editingConnectionId = connectionId;
          },
          saveDisabled: false,
        }}
      />,
    );

    const editButtons = screen.getAllByRole("button", { name: "Edit connection name" });
    const secondEditButton = editButtons[1];
    if (secondEditButton === undefined) {
      throw new Error("Expected a second edit connection name button.");
    }
    fireEvent.click(secondEditButton);
    expect(editingConnectionId).toBe("icn_github_archive");
  });

  it("renders a masked api key row for api key connections", () => {
    let editedConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_openai_primary",
            displayName: "OpenAI Production",
            authMethodId: "api-key",
            authMethodLabel: "API key",
            status: "active",
            resources: [],
          },
        ]}
        onEditApiKey={(connectionId) => {
          editedConnectionId = connectionId;
        }}
      />,
    );

    expect(screen.getByText("Auth method:")).toBeTruthy();
    expect(screen.getAllByText("API key")[0]).toBeTruthy();
    expect(screen.getByText("API key:")).toBeTruthy();
    expect(screen.getByText("**********")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit API key" }));
    expect(editedConnectionId).toBe("icn_openai_primary");
  });
});
