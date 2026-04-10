// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { IntegrationConnectionDetailView } from "./integration-connection-detail-view.js";

describe("IntegrationConnectionDetailView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders stacked connections and exposes refresh actions", () => {
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
            installActionLabel: "Manage installation",
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
    fireEvent.click(screen.getByRole("button", { name: "Manage installation" }));
    expect(startedGitHubAppInstallationConnectionId).toBe("icn_github_primary");
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

  it("starts title editing for the clicked connection", () => {
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

    const editButtons = screen.getAllByRole("button", { name: "Edit connection name" });
    const secondEditButton = editButtons[1];
    if (secondEditButton === undefined) {
      throw new Error("Expected a second edit connection name button.");
    }
    fireEvent.click(secondEditButton);
    expect(startedEditingConnectionId).toBe("icn_github_archive");
    expect(screen.getByDisplayValue("Archive Mirror")).toBeTruthy();
  });

  it("clears a stale connection save error when a new edit session starts", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Edit connection name" }));

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

    const authSection = screen.getByLabelText("Connection authentication");
    expect(authSection.getAttribute("data-auth-method-id")).toBe("api-key");
    expect(screen.getByLabelText("Masked API key value").getAttribute("data-api-key-state")).toBe(
      "masked",
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit API key" }));
    expect(editedConnectionId).toBe("icn_openai_primary");
  });

  it("renders masked Slack bot token credentials for Slack connections", () => {
    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_slack_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "Slack Engineering",
            authMethodId: "slack-bot-token",
            authMethodLabel: "Bot token",
            status: "active",
            resources: [],
          },
        ]}
      />,
    );

    const authSection = screen.getByLabelText("Connection authentication");
    expect(authSection.getAttribute("data-auth-method-id")).toBe("slack-bot-token");
    expect(screen.getByLabelText("Masked Slack credential values")).toBeTruthy();
    expect(screen.getByText("Bot token:")).toBeTruthy();
    expect(screen.getByText("Signing secret:")).toBeTruthy();
    expect(screen.getAllByText("**********")).toHaveLength(2);
  });

  it("shows delete only for unbound connections", () => {
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

    expect(screen.queryByRole("button", { name: "Delete connection Bound connection" })).toBeNull();
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
        onCreateWebhookSource={({ connectionId }) => {
          createdConnectionId = connectionId;
        }}
        onDeleteWebhookSource={({ connectionId, webhookSourceId }) => {
          deletedWebhookSource = { connectionId, webhookSourceId };
        }}
        showCreateWebhookSource={true}
        showWebhookSources={true}
        webhookSourceStateByConnectionId={
          new Map([
            [
              "icn_jira_primary",
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
                    integrationConnectionId: "icn_jira_primary",
                    displayName: "Primary Jira webhook",
                    endpointKey: "ep_jira_123",
                    callbackUrl:
                      "https://control-plane.example.com/v1/integration/webhooks/jira-default/ep_jira_123",
                    remoteRegistrationId: "10001",
                    status: "active",
                    providerMetadata: {},
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

    expect(screen.getByText("Webhooks")).toBeTruthy();
    expect(
      screen.getByText("Copy the callback URL into your provider's webhook configuration."),
    ).toBeTruthy();
    expect(screen.getByText("Primary Jira webhook")).toBeTruthy();
    expect(screen.getByText("whsec_jira_123")).toBeTruthy();
    expect(screen.queryByText("Endpoint key")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));
    expect(createdConnectionId).toBe("icn_jira_primary");

    fireEvent.click(
      screen.getByRole("button", { name: "Delete webhook source Primary Jira webhook" }),
    );
    expect(deletedWebhookSource).toEqual({
      connectionId: "icn_jira_primary",
      webhookSourceId: "iws_jira_123",
    });
  });

  it("does not show delete for implicit webhook sources", () => {
    let startedGitHubAppInstallationConnectionId: string | null = null;

    render(
      <IntegrationConnectionDetailView
        connections={[
          {
            id: "icn_github_primary",
            bindingCount: 0,
            canDelete: true,
            displayName: "GitHub Production",
            postInstallationSetupUrl:
              "http://localhost:5100/v1/integration/connections/github-app-installation/complete",
            installActionLabel: "Install GitHub App",
            authMethodId: "github-app-installation",
            authMethodLabel: "GitHub App installation",
            status: "active",
            resources: [],
            setupDescription:
              "Set the webhook callback URL and post-installation setup URL in your GitHub App settings, then install the app to finish setup.",
            setupStatusLabel: "Setup incomplete",
            webhookInstructions:
              "Copy the callback URL into your GitHub App webhook settings, then install the app to finish setup.",
          },
        ]}
        onStartGitHubAppInstallation={(connectionId) => {
          startedGitHubAppInstallationConnectionId = connectionId;
        }}
        showWebhookSources={true}
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
                      "https://control-plane.example.com/v1/integration/webhooks/github-cloud/ep_github_123",
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

    expect(
      screen.getAllByText(
        "Set the webhook callback URL and post-installation setup URL in your GitHub App settings, then install the app to finish setup.",
      ),
    ).toHaveLength(2);
    expect(screen.getAllByText("Setup incomplete")).toHaveLength(2);
    expect(screen.getByText("GitHub App setup")).toBeTruthy();
    expect(screen.getByText("Webhook callback URL")).toBeTruthy();
    expect(screen.getByText("Post-installation setup URL")).toBeTruthy();
    expect(
      screen.getByText(
        "https://control-plane.example.com/v1/integration/connections/github-app-installation/complete",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText(
        "https://control-plane.example.com/v1/integration/webhooks/github-cloud/ep_github_123",
      ),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Delete webhook source GitHub App webhook" }),
    ).toBeNull();

    const postInstallationSetupLabel = screen.getByText("Post-installation setup URL");
    const webhookCallbackLabel = screen.getByText("Webhook callback URL");
    expect(
      postInstallationSetupLabel.compareDocumentPosition(webhookCallbackLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Install GitHub App" }));
    expect(startedGitHubAppInstallationConnectionId).toBe("icn_github_primary");
  });

  it("hides create webhook when the target only supports implicit webhook sources", () => {
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
          },
        ]}
        onCreateWebhookSource={() => {
          throw new Error("Create webhook should not be available for implicit sources.");
        }}
        showCreateWebhookSource={false}
        showWebhookSources={true}
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
                      "https://control-plane.example.com/v1/integration/webhooks/github-cloud/ep_github_123",
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
    expect(screen.getByText("GitHub App webhook")).toBeTruthy();
  });
});
