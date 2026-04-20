// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";

const ManagedWebhookPolicy = {
  canCreateWebhookSource: true,
  canDeleteWebhookSource: true,
  showWebhookSources: true,
} as const;

const ImplicitWebhookPolicy = {
  canCreateWebhookSource: false,
  canDeleteWebhookSource: false,
  showWebhookSources: true,
} as const;

afterEach(() => {
  cleanup();
});

describe("IntegrationConnectionDetailView", () => {
  it("shows the identity badge for connections configured for identity linking", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            isIdentityLinked: true,
            status: "active",
            authMethodLabel: "GitHub App installation",
            resources: [],
          },
        ]}
      />,
    );

    expect(screen.getAllByText("IDENTITY")).toHaveLength(2);
  });

  it("disables delete when a connection is configured for identity linking", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: false,
            displayName: "Engineering GitHub",
            isIdentityLinked: true,
            status: "active",
            authMethodLabel: "GitHub App installation",
            resources: [],
          },
        ]}
        onDeleteConnection={() => {}}
      />,
    );

    const deleteButton = screen.getByRole("button", {
      name: "Delete connection Engineering GitHub",
    });

    expect(deleteButton.getAttribute("disabled")).toBe("");
    fireEvent.mouseEnter(deleteButton.parentElement ?? deleteButton);
    expect(
      screen.getByText(
        "This connection can't be deleted while it is configured for Identity Linking.",
      ),
    ).toBeTruthy();
  });

  it("hides authentication editing when a connection is configured for identity linking", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: false,
            displayName: "Engineering GitHub",
            isIdentityLinked: true,
            status: "active",
            authMethodLabel: "GitHub App installation",
            authMethodId: "github-app-installation",
            resources: [],
          },
        ]}
        onEditAuthentication={() => {}}
      />,
    );

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("renders connection navigation and exposes detail actions for the selected connection", () => {
    let refreshedKind: string | null = null;
    let startedGitHubAppInstallationConnectionId: string | null = null;
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 1,
            canDelete: false,
            displayName: "Engineering GitHub",
            status: "active",
            installation: {
              actionLabel: "Manage installation",
              fields: [
                { label: "App ID", value: "123" },
                { label: "App slug", value: "mistle-github-app" },
                { label: "Installation", value: "116007157" },
              ],
            },
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
            bindingCount: 0,
            canDelete: true,
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
        onStartGitHubAppInstallation={(connectionId) => {
          startedGitHubAppInstallationConnectionId = connectionId;
        }}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
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
                  {
                    id: "repo_2",
                    familyId: "github",
                    kind: "repositories",
                    handle: "mistle/control-plane-api",
                    displayName: "mistle/control-plane-api",
                    status: "accessible",
                    metadata: {},
                  },
                  {
                    id: "repo_3",
                    familyId: "github",
                    kind: "repositories",
                    handle: "mistle/data-plane-api",
                    displayName: "mistle/data-plane-api",
                    status: "accessible",
                    metadata: {},
                  },
                  {
                    id: "repo_4",
                    familyId: "github",
                    kind: "repositories",
                    handle: "mistle/ui",
                    displayName: "mistle/ui",
                    status: "accessible",
                    metadata: {},
                  },
                  {
                    id: "repo_5",
                    familyId: "github",
                    kind: "repositories",
                    handle: "mistle/docs",
                    displayName: "mistle/docs",
                    status: "accessible",
                    metadata: {},
                  },
                ],
                kind: "repositories",
                errorMessage: null,
              },
            ],
          ])
        }
      />,
    );

    expect(
      screen.getByRole("button", { name: "Select connection Engineering GitHub" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select connection Archive Mirror" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Select connection" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Engineering GitHub" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Installation" })).toBeTruthy();
    expect(screen.getAllByText("Resources")).toHaveLength(1);
    expect(screen.getByText("Repository")).toBeTruthy();
    expect(screen.getByText("- 41")).toBeTruthy();
    expect(screen.queryByText("- 0")).toBeNull();
    const expandRepositoryButton = screen.getByRole("button", {
      name: "Expand repository resources",
    });
    expect(screen.queryByText("mistle/dashboard")).toBeNull();
    expect(screen.queryByText("mistle/docs")).toBeNull();
    fireEvent.click(expandRepositoryButton);
    expect(screen.getByText("mistle/dashboard")).toBeTruthy();
    expect(screen.getByText("mistle/docs")).toBeTruthy();
    const collapseRepositoryButton = screen.getByRole("button", {
      name: "Collapse repository resources",
    });
    fireEvent.click(collapseRepositoryButton);
    expect(screen.queryByText("mistle/dashboard")).toBeNull();
    expect(screen.queryByText("mistle/docs")).toBeNull();
    const refreshButton = screen.getByRole("button", { name: "Refresh repositories" });
    fireEvent.click(refreshButton);
    expect(refreshedKind).toBe("repositories");
    fireEvent.click(screen.getByRole("button", { name: "Manage installation" }));
    expect(startedGitHubAppInstallationConnectionId).toBe("icn_github_primary");
    fireEvent.click(screen.getByRole("button", { name: "Select connection Archive Mirror" }));
    expect(screen.getByRole("heading", { name: "Archive Mirror" })).toBeTruthy();
    expect(screen.getByText("Repository")).toBeTruthy();
    expect(screen.getByText("- 0")).toBeTruthy();
    expect(
      screen.queryByText("GitHub returned a 403 while reading repository visibility."),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage installation" })).toBeNull();
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
            bindingCount: 0,
            canDelete: true,
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

  it("shows resource load errors while the row is collapsed and keeps items hidden", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 41,
                syncState: "ready",
                lastSyncedAt: "2026-03-11T04:25:00.000Z",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
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
                errorMessage: "Could not load repositories.",
              },
            ],
          ])
        }
      />,
    );

    expect(screen.queryByLabelText("View sync failure details")).toBeNull();
    expect(screen.queryByText("Could not load repositories.")).toBeNull();
    expect(screen.queryByText(/Last synced/)).toBeNull();
    expect(screen.queryByText("mistle/dashboard")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand repository resources" }));
    expect(screen.getByText("mistle/dashboard")).toBeTruthy();
  });

  it("keeps the never-synced status separate from the expanded empty contents", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 0,
                syncState: "never-synced",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
                isLoading: false,
                items: [],
                kind: "repositories",
                errorMessage: null,
              },
            ],
          ])
        }
      />,
    );

    expect(screen.queryAllByText("Not synced yet")).not.toHaveLength(0);
    expect(screen.queryByLabelText("View sync failure details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand repository resources" }));
    expect(screen.queryAllByText("Not synced yet")).not.toHaveLength(0);
    expect(screen.getByText("No items available.")).toBeTruthy();
  });

  it("shows a loading state instead of an empty state while resource items are loading", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 0,
                syncState: "ready",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
                isLoading: true,
                items: [],
                kind: "repositories",
                errorMessage: null,
              },
            ],
          ])
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand repository resources" }));
    expect(screen.getByText("Loading items...")).toBeTruthy();
    expect(screen.queryByText("No items available.")).toBeNull();
  });

  it("keeps the sync failure status separate from the expanded empty contents", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 0,
                syncState: "error",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
                isLoading: false,
                items: [],
                kind: "repositories",
                errorMessage: "Could not load repositories.",
              },
            ],
          ])
        }
      />,
    );

    expect(screen.getAllByText("Sync failed")).toHaveLength(2);
    expect(screen.getAllByLabelText("View sync failure details")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Expand repository resources" }));
    expect(screen.getAllByText("Sync failed")).toHaveLength(2);
    expect(screen.getAllByLabelText("View sync failure details")).toHaveLength(2);
    expect(screen.queryByText("Could not load repositories.")).toBeNull();
    expect(screen.getByText("No items available.")).toBeTruthy();
  });

  it("prefers the sync failure reason over the resource items error in the tooltip", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 0,
                syncState: "error",
                lastErrorMessage:
                  "GitHub returned a 403 while syncing repositories from the last sync attempt.",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
                isLoading: false,
                items: [],
                kind: "repositories",
                errorMessage: "Could not load repositories.",
              },
            ],
          ])
        }
      />,
    );

    const tooltipTrigger = screen.getAllByLabelText("View sync failure details")[0];
    if (tooltipTrigger === undefined) {
      throw new Error("Expected a sync failure tooltip trigger.");
    }
    fireEvent.mouseEnter(tooltipTrigger);

    expect(
      screen.getByText(
        "GitHub returned a 403 while syncing repositories from the last sync attempt.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Could not load repositories.")).toBeNull();
  });

  it("shows an expanded empty state when a resource has no items", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 0,
                syncState: "ready",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
                isLoading: false,
                items: [],
                kind: "repositories",
                errorMessage: null,
              },
            ],
          ])
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand repository resources" }));
    expect(screen.getByText("No items available.")).toBeTruthy();
  });

  it("starts title editing when the connection title field receives focus", () => {
    let startedEditingConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
          {
            id: "icn_github_archive",
            bindingCount: 0,
            canDelete: true,
            displayName: "Archive Mirror",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
        ]}
        titleEditor={{
          disabled: false,
          onStartEditing: (connectionId) => {
            startedEditingConnectionId = connectionId;
          },
          errorMessageByConnectionId: {},
          onSave: async () => {},
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select connection Archive Mirror" }));
    fireEvent.focus(screen.getByRole("textbox", { name: "Connection name" }));
    expect(startedEditingConnectionId).toBe("icn_github_archive");
    expect(screen.getByDisplayValue("Archive Mirror")).toBeTruthy();
  });

  it("resets expanded resource state when switching connections", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Engineering GitHub",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 2,
                syncState: "ready",
                lastSyncedAt: "2026-03-11T04:25:00.000Z",
              },
            ],
          },
          {
            id: "icn_github_archive",
            bindingCount: 0,
            canDelete: true,
            displayName: "Archive Mirror",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [
              {
                kind: "repositories",
                count: 2,
                syncState: "ready",
                lastSyncedAt: "2026-03-11T04:25:00.000Z",
              },
            ],
          },
        ]}
        resourceItemsByKey={
          new Map([
            [
              "icn_github_primary:repositories",
              {
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
                errorMessage: null,
              },
            ],
            [
              "icn_github_archive:repositories",
              {
                isLoading: false,
                items: [
                  {
                    id: "repo_2",
                    familyId: "github",
                    kind: "repositories",
                    handle: "mistle/archive",
                    displayName: "mistle/archive",
                    status: "accessible",
                    metadata: {},
                  },
                ],
                kind: "repositories",
                errorMessage: null,
              },
            ],
          ])
        }
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand repository resources" }));
    expect(screen.getByText("mistle/dashboard")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Select connection Archive Mirror" }));
    expect(screen.queryByText("mistle/dashboard")).toBeNull();
    expect(screen.queryByText("mistle/archive")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand repository resources" })).toBeTruthy();
  });

  it("clears a stale connection save error when the title field receives focus again", () => {
    function ErrorHarness(): React.JSX.Element {
      const [errorMessageByConnectionId, setErrorMessageByConnectionId] = useState<
        Readonly<Record<string, string | undefined>>
      >({
        icn_github_primary: "Could not update connection.",
      });

      return (
        <IntegrationConnectionDetailView
          connections={[
            {
              id: "icn_github_primary",
              bindingCount: 0,
              canDelete: true,
              displayName: "Engineering GitHub",
              authMethodId: "github-app-installation",
              authMethodLabel: "GitHub App installation",
              status: "active",
              resources: [],
            },
          ]}
          titleEditor={{
            disabled: false,
            onStartEditing: (connectionId) => {
              setErrorMessageByConnectionId((current) => ({
                ...current,
                [connectionId]: undefined,
              }));
            },
            errorMessageByConnectionId,
            onSave: async () => {},
          }}
        />
      );
    }

    render(<ErrorHarness />);

    expect(screen.getByText("Could not update connection.")).toBeTruthy();

    const input = screen.getByRole("textbox", { name: "Connection name" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByText("Could not update connection.")).toBeNull();

    fireEvent.focus(screen.getByRole("textbox", { name: "Connection name" }));

    expect(screen.getByRole("textbox", { name: "Connection name" })).toBeTruthy();
    expect(screen.queryByText("Could not update connection.")).toBeNull();
  });

  it("renders a masked api key row for api key connections", () => {
    let editedConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_openai_primary",
            bindingCount: 0,
            canDelete: true,
            authSecretLabels: ["API key"],
            displayName: "OpenAI Production",
            authMethodId: "api-key",
            authMethodLabel: "API key",
            status: "active",
            resources: [],
          },
        ]}
        onEditAuthentication={(connectionId) => {
          editedConnectionId = connectionId;
        }}
      />,
    );

    const authSection = screen.getByLabelText("Connection authentication");
    expect(authSection.getAttribute("data-auth-method-id")).toBe("api-key");
    expect(within(authSection).getAllByText("API key")).toHaveLength(2);
    expect(within(authSection).getAllByText("**********")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(editedConnectionId).toBe("icn_openai_primary");
  });

  it("renders a generic edit action for non-api-key connections", () => {
    let editedConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_jira_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Jira Production",
            authMethodId: "jira-personal-api-token",
            authMethodLabel: "Personal API token",
            status: "active",
            resources: [],
          },
        ]}
        onEditAuthentication={(connectionId) => {
          editedConnectionId = connectionId;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(editedConnectionId).toBe("icn_jira_primary");
  });

  it("keeps Manage installation visible alongside Edit for installed GitHub App connections", () => {
    let editedConnectionId: string | null = null;
    let startedGitHubAppInstallationConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_installed",
            bindingCount: 0,
            canDelete: true,
            displayName: "GitHub Production",
            installation: {
              actionLabel: "Manage installation",
              fields: [
                { label: "App ID", value: "123" },
                { label: "App slug", value: "mistle-github-app" },
                { label: "Installation", value: "116007157" },
              ],
            },
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
        ]}
        onEditAuthentication={(connectionId) => {
          editedConnectionId = connectionId;
        }}
        onStartGitHubAppInstallation={(connectionId) => {
          startedGitHubAppInstallationConnectionId = connectionId;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage installation" }));

    expect(editedConnectionId).toBe("icn_github_installed");
    expect(startedGitHubAppInstallationConnectionId).toBe("icn_github_installed");
  });

  it("renders visible non-secret auth fields under authentication", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_jira_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Jira Production",
            authFields: [
              {
                label: "Method",
                value: "Personal API token",
              },
              {
                label: "Site URL",
                value: "https://mistle.atlassian.net",
              },
              {
                label: "Email",
                value: "dev@mistle.so",
              },
            ],
            authSecretLabels: ["Personal API token"],
            authMethodId: "jira-personal-api-token",
            authMethodLabel: "Personal API token",
            status: "active",
            resources: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("Site URL")).toBeTruthy();
    expect(screen.getByText("https://mistle.atlassian.net")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("dev@mistle.so")).toBeTruthy();
    const authSection = screen.getByLabelText("Connection authentication");
    expect(within(authSection).getAllByText("Personal API token")).toHaveLength(2);
    expect(within(authSection).getAllByText("**********")).toHaveLength(1);
  });

  it("renders masked secret fields for Slack connections", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_slack_primary",
            bindingCount: 0,
            canDelete: true,
            authSecretLabels: ["Bot token", "Signing secret"],
            displayName: "Slack Engineering",
            authMethodId: "slack-bot-token",
            authMethodLabel: "Slack app",
            status: "active",
            resources: [],
          },
        ]}
      />,
    );

    const authSection = screen.getByLabelText("Connection authentication");
    expect(authSection.getAttribute("data-auth-method-id")).toBe("slack-bot-token");
    expect(within(authSection).getByText("Slack app")).toBeTruthy();
    expect(within(authSection).getByText("Bot token")).toBeTruthy();
    expect(within(authSection).getByText("Signing secret")).toBeTruthy();
    expect(within(authSection).getAllByText("**********")).toHaveLength(2);
  });

  it("shows delete for all connections and disables it when bindings prevent deletion", () => {
    let deletedConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_bound",
            bindingCount: 2,
            canDelete: false,
            displayName: "Bound connection",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
          {
            id: "icn_free",
            bindingCount: 0,
            canDelete: true,
            displayName: "Free connection",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
          },
        ]}
        onDeleteConnection={(connectionId) => {
          deletedConnectionId = connectionId;
        }}
      />,
    );

    const boundDeleteButton = screen.getByRole("button", {
      name: "Delete connection Bound connection",
    });
    expect(boundDeleteButton).toHaveProperty("disabled", true);
    expect(boundDeleteButton.getAttribute("title")).toBe(
      "This connection can't be deleted while it has 2 bindings.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Select connection Free connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete connection Free connection" }));
    expect(deletedConnectionId).toBe("icn_free");
  });

  it("renders webhook sources and create/delete actions", () => {
    let createdConnectionId: string | null = null;
    let deletedWebhookSource: { connectionId: string; webhookSourceId: string } | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_webhook_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Webhook Connection",
            authMethodId: "api-key",
            authMethodLabel: "API key",
            status: "active",
            resources: [],
          },
        ]}
        onCreateWebhookSource={({ connectionId }) => {
          createdConnectionId = connectionId;
        }}
        onDeleteWebhookSource={({ connectionId, webhookSourceId }) => {
          deletedWebhookSource = { connectionId, webhookSourceId };
        }}
        webhookPolicy={ManagedWebhookPolicy}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_webhook_primary",
              {
                createErrorMessage: null,
                deleteErrorMessage: null,
                deletingWebhookSourceId: null,
                isCreating: false,
                isLoading: false,
                items: [
                  {
                    id: "iws_jira_123",
                    targetKey: "jira-default",
                    integrationConnectionId: "icn_webhook_primary",
                    displayName: "Primary Jira webhook",
                    endpointKey: "ep_jira_123",
                    callbackUrl:
                      "https://control-plane.example.com/p/integration/webhooks/jira-default/ep_jira_123",
                    remoteRegistrationId: "10001",
                    status: "active",
                    providerMetadata: {
                      registeredEvents: [
                        "jira:issue_created",
                        "jira:issue_updated",
                        "comment_created",
                        "comment_updated",
                      ],
                    },
                    createdAt: "2026-04-03T00:00:00.000Z",
                    updatedAt: "2026-04-03T00:00:00.000Z",
                  },
                ],
                loadErrorMessage: null,
                revealedWebhookSecret: "whsec_jira_123",
              },
            ],
          ])
        }
      />,
    );

    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(
      screen.queryByText("Copy the callback URL into your provider's webhook configuration."),
    ).toBeNull();
    expect(screen.queryByText("Primary Jira webhook")).toBeNull();
    expect(screen.queryByText("Webhook source ID: iws_jira_123")).toBeNull();
    expect(screen.queryByText("Target")).toBeNull();
    expect(screen.queryByText("jira-default")).toBeNull();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Provider registration")).toBeTruthy();
    expect(screen.getByText("10001")).toBeTruthy();
    expect(screen.getByText("Registered events")).toBeTruthy();
    expect(screen.getByText("Issue created")).toBeTruthy();
    expect(screen.getByText("Issue updated")).toBeTruthy();
    expect(screen.getByText("Comment created")).toBeTruthy();
    expect(screen.getByText("Comment updated")).toBeTruthy();
    expect(screen.getByText("Webhook URL")).toBeTruthy();
    expect(screen.getByText("whsec_jira_123")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create webhook" })).toBeNull();
    expect(screen.queryByText("Endpoint key")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Delete webhook source Primary Jira webhook" }),
    );
    expect(deletedWebhookSource).toEqual({
      connectionId: "icn_webhook_primary",
      webhookSourceId: "iws_jira_123",
    });
    expect(createdConnectionId).toBeNull();
  });

  it.each([
    ["active", "Active"],
    ["disabled", "Disabled"],
    ["error", "Error"],
  ] as const)("renders Jira webhook status %s in webhook section", (status, expectedLabel) => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_jira_status",
            bindingCount: 0,
            canDelete: true,
            displayName: "Jira Connection",
            authMethodId: "jira-personal-api-token",
            authMethodLabel: "Personal API token",
            status: "active",
            resources: [],
          },
        ]}
        webhookPolicy={ManagedWebhookPolicy}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_jira_status",
              {
                createErrorMessage: null,
                deleteErrorMessage: null,
                deletingWebhookSourceId: null,
                isCreating: false,
                isLoading: false,
                items: [
                  {
                    id: "iws_jira_status",
                    targetKey: "jira-default",
                    integrationConnectionId: "icn_jira_status",
                    displayName: "Primary Jira webhook",
                    endpointKey: "ep_jira_status",
                    callbackUrl:
                      "https://control-plane.example.com/p/integration/webhooks/jira-default/ep_jira_status",
                    remoteRegistrationId: "10001",
                    status,
                    providerMetadata: {},
                    createdAt: "2026-04-03T00:00:00.000Z",
                    updatedAt: "2026-04-03T00:00:00.000Z",
                  },
                ],
                loadErrorMessage: null,
                revealedWebhookSecret: null,
              },
            ],
          ])
        }
      />,
    );

    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(screen.queryByText("Primary Jira webhook")).toBeNull();
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText(expectedLabel)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Webhook URL" })).toBeTruthy();
  });

  it("renders generic setup guidance without setup URLs", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_setup",
            bindingCount: 0,
            canDelete: true,
            displayName: "GitHub App Setup",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
            installation: {
              actionLabel: "Install GitHub App",
              description: "Set the URLs below in your Github App settings, then install the app",
              fields: [{ label: "Installation", value: "Pending" }],
            },
          },
        ]}
        onStartGitHubAppInstallation={() => {}}
        onCreateWebhookSource={() => {}}
        webhookPolicy={ManagedWebhookPolicy}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_github_setup",
              {
                createErrorMessage: null,
                deleteErrorMessage: null,
                deletingWebhookSourceId: null,
                isCreating: false,
                isLoading: false,
                items: [],
                loadErrorMessage: null,
                revealedWebhookSecret: null,
              },
            ],
          ])
        }
      />,
    );

    const installationSection = screen
      .getByRole("heading", { name: "Installation" })
      .closest("section");
    expect(installationSection).toBeTruthy();
    expect(
      within(installationSection as HTMLElement).getByText(
        "Set the URLs below in your Github App settings, then install the app",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Webhook")).toBeNull();
    expect(screen.queryByText("No webhook is configured for this connection.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create webhook" })).toBeNull();
    expect(screen.queryByText("Webhook URL")).toBeNull();
  });

  it("renders Jira webhook empty state without requiring a setup section", () => {
    let createdConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_jira_empty",
            bindingCount: 0,
            canDelete: true,
            displayName: "Jira Production",
            authMethodId: "jira-personal-api-token",
            authMethodLabel: "Personal API token",
            status: "active",
            resources: [],
          },
        ]}
        onCreateWebhookSource={({ connectionId }) => {
          createdConnectionId = connectionId;
        }}
        webhookPolicy={ManagedWebhookPolicy}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_jira_empty",
              {
                createErrorMessage: null,
                deleteErrorMessage: null,
                deletingWebhookSourceId: null,
                isCreating: false,
                isLoading: false,
                items: [],
                loadErrorMessage: null,
                revealedWebhookSecret: null,
              },
            ],
          ])
        }
      />,
    );

    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(screen.getByText("No webhook is configured for this connection.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    expect(createdConnectionId).toBe("icn_jira_empty");
  });

  it("hides the standalone webhook section for GitHub App connections", () => {
    let startedGitHubAppInstallationConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "GitHub Production",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
            installation: {
              actionLabel: "Install GitHub App",
              description: "Set the URLs below in your Github App settings, then install the app",
              fields: [{ label: "Installation", value: "Pending" }],
              postInstallationSetupUrl:
                "http://localhost:5100/p/integration/callbacks/github-app-installation",
            },
          },
        ]}
        onStartGitHubAppInstallation={(connectionId) => {
          startedGitHubAppInstallationConnectionId = connectionId;
        }}
        webhookPolicy={ImplicitWebhookPolicy}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_github_primary",
              {
                createErrorMessage: null,
                deleteErrorMessage: null,
                deletingWebhookSourceId: null,
                isCreating: false,
                isLoading: false,
                items: [
                  {
                    id: "iws_github_123",
                    targetKey: "github-cloud",
                    integrationConnectionId: "icn_github_primary",
                    displayName: "GitHub App webhook",
                    endpointKey: "ep_github_123",
                    callbackUrl:
                      "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github_123",
                    status: "active",
                    providerMetadata: {},
                    createdAt: "2026-04-03T00:00:00.000Z",
                    updatedAt: "2026-04-03T00:00:00.000Z",
                  },
                ],
                loadErrorMessage: null,
                revealedWebhookSecret: null,
              },
            ],
          ])
        }
      />,
    );

    const installationSection = screen
      .getByRole("heading", { name: "Installation" })
      .closest("section");
    expect(installationSection).toBeTruthy();
    expect(
      within(installationSection as HTMLElement).getByText(
        "Set the URLs below in your Github App settings, then install the app",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Webhook callback URL")).toBeTruthy();
    expect(screen.getByText("Post-installation setup URL")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Webhook callback URL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Post-installation setup URL" })).toBeTruthy();
    expect(
      screen.queryByText(
        "Copy the callback URL into your GitHub App webhook settings, then install the app to finish setup.",
      ),
    ).toBeNull();
    expect(
      screen.getByText(
        "https://control-plane.example.com/p/integration/callbacks/github-app-installation",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText(
        "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github_123",
      ),
    ).toHaveLength(1);
    expect(screen.queryByText("Webhook")).toBeNull();
    expect(screen.queryByText("GitHub App webhook")).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByText("Webhook URL")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete webhook source GitHub App webhook" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete webhook" })).toBeNull();

    const postInstallationSetupLabel = screen.getByText("Post-installation setup URL");
    const webhookCallbackLabel = screen.getByText("Webhook callback URL");
    expect(
      postInstallationSetupLabel.compareDocumentPosition(webhookCallbackLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Install GitHub App" }));
    expect(startedGitHubAppInstallationConnectionId).toBe("icn_github_primary");
  });

  it("hides the standalone webhook section for installed GitHub App connections", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "GitHub Production",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
            installation: {
              actionLabel: "Manage installation",
              fields: [{ label: "Installation", value: "116007157" }],
            },
          },
        ]}
        onCreateWebhookSource={() => {
          throw new Error("Create webhook should not be available for implicit sources.");
        }}
        webhookPolicy={ImplicitWebhookPolicy}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_github_primary",
              {
                createErrorMessage: null,
                deleteErrorMessage: null,
                deletingWebhookSourceId: null,
                isCreating: false,
                isLoading: false,
                items: [
                  {
                    id: "iws_github_123",
                    targetKey: "github-cloud",
                    integrationConnectionId: "icn_github_primary",
                    displayName: "GitHub App webhook",
                    endpointKey: "ep_github_123",
                    callbackUrl:
                      "https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_github_123",
                    status: "active",
                    providerMetadata: {},
                    createdAt: "2026-04-03T00:00:00.000Z",
                    updatedAt: "2026-04-03T00:00:00.000Z",
                  },
                ],
                loadErrorMessage: null,
                revealedWebhookSecret: null,
              },
            ],
          ])
        }
      />,
    );

    expect(screen.queryByRole("button", { name: "Create webhook" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy Webhook URL" })).toBeNull();
    expect(screen.queryByText("Webhook")).toBeNull();
    expect(screen.getByText("Webhook callback URL")).toBeTruthy();
  });
});
