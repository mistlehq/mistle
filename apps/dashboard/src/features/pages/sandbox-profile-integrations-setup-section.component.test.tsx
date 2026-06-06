// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  StoryAnthropicConnection,
  StoryAnthropicTarget,
  StoryDatadogTarget,
  StoryGithubConnection,
  StoryGithubTarget,
  StoryJiraConnection,
  StoryJiraTarget,
  StoryOpenCodeGoConnection,
  StoryOpenCodeGoTarget,
  StoryOpenAiConnection,
  StoryOpenAiTarget,
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileIntegrationsSetupSection,
  SandboxProfileIntegrationsSetupUnavailableState,
} from "./sandbox-profile-integrations-setup-section.js";

type SandboxProfileIntegrationsSetupSectionProps = ComponentProps<
  typeof SandboxProfileIntegrationsSetupSection
>;

afterEach(() => {
  cleanup();
});

describe("SandboxProfileIntegrationsSetupSection", () => {
  it("keeps the add integration or tool action visible in drafts when no connector integrations are configured", () => {
    const { container } = render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryGithubConnection],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget],
          integrationRows: [],
        }}
      />,
    );

    const addAction = screen.getByRole("button", { name: "Add integration or tool" });
    expect(addAction.hasAttribute("disabled")).toBe(true);
    expect(queryEmptySectionCards(container)).toHaveLength(0);
  });

  it("does not render an empty connector integrations card in read-only mode", () => {
    const { container } = render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryGithubConnection],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget, StoryDatadogTarget],
          integrationRows: [],
          readOnly: true,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Add integration or tool" })).toBeNull();
    expect(queryEmptySectionCards(container)).toHaveLength(0);
  });

  it("keeps git connection separate while labeling integration rows with proxied connections and tools", () => {
    const storyGithubConnectionWithoutResources = {
      ...StoryGithubConnection,
      resources: [],
    };

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [
            StoryOpenAiConnection,
            storyGithubConnectionWithoutResources,
            StoryJiraConnection,
          ],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget, StoryJiraTarget],
          integrationRows: [
            {
              clientId: "agent-row",
              connectionId: StoryOpenAiConnection.id,
              kind: "agent",
              config: {},
            },
            {
              clientId: "git-row",
              connectionId: storyGithubConnectionWithoutResources.id,
              kind: "git",
              config: {},
            },
            {
              clientId: "jira-row",
              connectionId: StoryJiraConnection.id,
              kind: "connector",
              config: {},
            },
          ],
        }}
      />,
    );

    const runtimeSection = screen.getByRole("heading", { name: "Runtime" }).closest("section");
    if (runtimeSection === null) {
      throw new Error("Expected Runtime heading to be inside a section.");
    }
    const runtime = within(runtimeSection);

    expect(runtime.getByText("Git Connection")).toBeDefined();
    expect(runtime.getAllByText("Integration").length).toBeGreaterThan(0);
    expect(runtime.getAllByText("Proxied Connection").length).toBeGreaterThan(0);
    expect(runtime.getAllByText("Resources & Tools").length).toBeGreaterThan(0);
    expect(runtime.getByText("OpenAI")).toBeDefined();
    expect(runtime.getByText("Jira")).toBeDefined();
    const openAiLogo = runtime
      .getByText("OpenAI")
      .closest("div")
      ?.querySelector('img[src="/integration-logos/openai.svg"]');
    expect(openAiLogo).toBeDefined();
    expect(runtime.getByText("Primary OpenAI Workspace")).toBeDefined();
    expect(runtime.getByText("GitHub - GitHub Production")).toBeDefined();
    expect(runtime.getByText("Jira Production")).toBeDefined();
  });

  it("enables commit signing for the selected identity-linked Git connection", () => {
    const gitCommitSigningConnectionChanges: Array<string | null> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryGithubConnection],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget],
          gitCommitSigningIntegrationConnectionId: StoryGithubConnection.id,
          identityLinkedGitConnectionIds: [StoryGithubConnection.id],
          integrationRows: [
            {
              clientId: "git-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
          onGitCommitSigningIntegrationConnectionChange: (connectionId) => {
            gitCommitSigningConnectionChanges.push(connectionId);
          },
        }}
      />,
    );

    const switchControl = screen.getByRole("switch", { name: "Sign Git commits" });
    expect(switchControl.getAttribute("aria-checked")).toBe("true");
    expect(switchControl.hasAttribute("data-disabled")).toBe(false);
    fireEvent.click(switchControl);
    expect(gitCommitSigningConnectionChanges).toEqual([null]);
    expect(screen.getByRole("button", { name: "About Git commit signing" })).toBeDefined();
  });

  it("allows commit signing to be turned on for the selected identity-linked Git connection", () => {
    const gitCommitSigningConnectionChanges: Array<string | null> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryGithubConnection],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget],
          gitCommitSigningIntegrationConnectionId: null,
          identityLinkedGitConnectionIds: [StoryGithubConnection.id],
          integrationRows: [
            {
              clientId: "git-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
          onGitCommitSigningIntegrationConnectionChange: (connectionId) => {
            gitCommitSigningConnectionChanges.push(connectionId);
          },
        }}
      />,
    );

    const switchControl = screen.getByRole("switch", { name: "Sign Git commits" });
    expect(switchControl.getAttribute("aria-checked")).toBe("false");
    expect(switchControl.hasAttribute("data-disabled")).toBe(false);
    fireEvent.click(switchControl);
    expect(gitCommitSigningConnectionChanges).toEqual([StoryGithubConnection.id]);
  });

  it("disables commit signing when the selected Git connection is not identity-linked", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryGithubConnection],
          availableTargets: [StoryGithubTarget],
          identityLinkedGitConnectionIds: [],
          integrationRows: [
            {
              clientId: "git-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
        }}
      />,
    );

    const switchControl = screen.getByRole("switch", { name: "Sign Git commits" });
    expect(switchControl.hasAttribute("data-disabled")).toBe(true);
    expect(screen.getByText("identity linking to enable")).toBeDefined();
    expect(screen.getByRole("link", { name: "Configure" })).toHaveProperty(
      "pathname",
      "/settings/organization/identity-linking",
    );
  });

  it("preserves commit signing while identity-linking state is loading", () => {
    const gitCommitSigningConnectionChanges: Array<string | null> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryGithubConnection],
          availableTargets: [StoryGithubTarget],
          gitCommitSigningIntegrationConnectionId: StoryGithubConnection.id,
          identityLinkedGitConnectionIds: null,
          integrationRows: [
            {
              clientId: "git-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
          onGitCommitSigningIntegrationConnectionChange: (connectionId) => {
            gitCommitSigningConnectionChanges.push(connectionId);
          },
        }}
      />,
    );

    const switchControl = screen.getByRole("switch", { name: "Sign Git commits" });
    expect(switchControl.getAttribute("aria-checked")).toBe("true");
    expect(switchControl.hasAttribute("data-disabled")).toBe(true);
    expect(screen.getByText("Loading identity linking")).toBeDefined();
    expect(gitCommitSigningConnectionChanges).toEqual([]);
  });

  it("clears commit signing when changing the Git connection before identity-linking state loads", async () => {
    const secondaryGithubConnection: IntegrationConnectionSummary = {
      ...StoryGithubConnection,
      id: "connection-github-secondary",
      displayName: "GitHub Secondary",
    };
    const gitCommitSigningConnectionChanges: Array<string | null> = [];
    const rowChanges: Array<{
      clientId: string;
      connectionId: string | undefined;
    }> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryGithubConnection, secondaryGithubConnection],
          availableTargets: [StoryGithubTarget],
          gitCommitSigningIntegrationConnectionId: StoryGithubConnection.id,
          identityLinkedGitConnectionIds: null,
          integrationRows: [
            {
              clientId: "git-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
          onGitCommitSigningIntegrationConnectionChange: (connectionId) => {
            gitCommitSigningConnectionChanges.push(connectionId);
          },
          onIntegrationBindingRowChange: (clientId, changes) => {
            rowChanges.push({
              clientId,
              connectionId: changes.connectionId,
            });
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "git connection" }));
    const secondaryOption = screen.getByRole("option", { name: "GitHub - GitHub Secondary" });
    fireEvent.mouseMove(secondaryOption);
    fireEvent.mouseDown(secondaryOption, { button: 0 });
    fireEvent.mouseUp(secondaryOption, { button: 0 });
    fireEvent.click(secondaryOption, { button: 0 });

    await waitFor(() => {
      expect(rowChanges).toEqual([
        {
          clientId: "git-row",
          connectionId: secondaryGithubConnection.id,
        },
      ]);
      expect(gitCommitSigningConnectionChanges).toEqual([null]);
    });
  });

  it("does not rewrite a persisted commit signing mismatch when identity linking is unavailable", () => {
    const gitCommitSigningConnectionChanges: Array<string | null> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryGithubConnection],
          availableTargets: [StoryGithubTarget],
          gitCommitSigningIntegrationConnectionId: StoryGithubConnection.id,
          identityLinkedGitConnectionIds: [],
          integrationRows: [
            {
              clientId: "git-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
          onGitCommitSigningIntegrationConnectionChange: (connectionId) => {
            gitCommitSigningConnectionChanges.push(connectionId);
          },
        }}
      />,
    );

    const switchControl = screen.getByRole("switch", { name: "Sign Git commits" });
    expect(switchControl.getAttribute("aria-checked")).toBe("true");
    expect(switchControl.hasAttribute("data-disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Configure" })).toBeDefined();
    expect(screen.getByText("identity linking to enable")).toBeDefined();
    expect(gitCommitSigningConnectionChanges).toEqual([]);
  });

  it("renders editable connector binding config controls in resources and tools", () => {
    const rowChanges: Array<{
      clientId: string;
      config: Record<string, unknown> | undefined;
    }> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryGcpConnection],
          availableTargets: [StoryGcpTarget],
          integrationRows: [
            {
              clientId: "gcp-row",
              connectionId: StoryGcpConnection.id,
              kind: "connector",
              config: {},
            },
          ],
          onIntegrationBindingRowChange: (clientId, changes) => {
            rowChanges.push({
              clientId,
              config: changes.config,
            });
          },
        }}
      />,
    );

    expect(screen.queryByText("GOOGLE CLOUD MCP SERVERS")).toBeNull();
    const loggingCheckbox = screen.getByRole("checkbox", {
      name: "Cloud Logging",
    });
    const cloudRunCheckbox = screen.getByRole("checkbox", { name: "Cloud Run" });
    const gkeCheckbox = screen.getByRole("checkbox", {
      name: "Google Kubernetes Engine",
    });

    fireEvent.click(loggingCheckbox);
    expect(rowChanges).toContainEqual({
      clientId: "gcp-row",
      config: {
        mcpServers: ["cloud_logging"],
      },
    });

    fireEvent.click(cloudRunCheckbox);
    expect(rowChanges).toContainEqual({
      clientId: "gcp-row",
      config: {
        mcpServers: ["cloud_logging", "cloud_run"],
      },
    });

    fireEvent.click(gkeCheckbox);
    expect(rowChanges).toContainEqual({
      clientId: "gcp-row",
      config: {
        mcpServers: ["cloud_logging", "cloud_run", "gke"],
      },
    });
  });

  it("limits Codex proxied model providers to OpenAI and removes OpenCode-only agent bindings", async () => {
    const removedRows: string[] = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          agentRuntimeId: "codex",
          availableConnections: [
            StoryOpenAiConnection,
            StoryOpenCodeGoConnection,
            StoryAnthropicConnection,
          ],
          availableTargets: [StoryOpenAiTarget, StoryOpenCodeGoTarget, StoryAnthropicTarget],
          integrationRows: [
            {
              clientId: "openai-agent-row",
              connectionId: StoryOpenAiConnection.id,
              kind: "agent",
              config: {},
            },
            {
              clientId: "opencode-agent-row",
              connectionId: StoryOpenCodeGoConnection.id,
              kind: "agent",
              config: {},
            },
            {
              clientId: "anthropic-agent-row",
              connectionId: StoryAnthropicConnection.id,
              kind: "agent",
              config: {},
            },
          ],
          onRemoveIntegrationBindingRow: (clientId) => {
            removedRows.push(clientId);
          },
        }}
      />,
    );

    const proxiedConnections = within(getProxiedConnectionsSection());

    expect(proxiedConnections.getByText("OpenAI")).toBeDefined();
    expect(proxiedConnections.queryByText("OpenCode Go")).toBeNull();
    expect(proxiedConnections.queryByText("Anthropic")).toBeNull();
    await waitFor(() => {
      expect(removedRows).toEqual(["opencode-agent-row", "anthropic-agent-row"]);
    });
  });

  it("shows all configured OpenCode-compatible model providers as optional proxied connections", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          agentRuntimeId: "opencode",
          availableConnections: [
            StoryOpenAiConnection,
            StoryOpenCodeGoConnection,
            StoryAnthropicConnection,
          ],
          availableTargets: [StoryOpenAiTarget, StoryOpenCodeGoTarget, StoryAnthropicTarget],
          integrationRows: [
            {
              clientId: "openai-agent-row",
              connectionId: StoryOpenAiConnection.id,
              kind: "agent",
              config: {},
            },
            {
              clientId: "anthropic-agent-row",
              connectionId: StoryAnthropicConnection.id,
              kind: "agent",
              config: {},
            },
          ],
        }}
      />,
    );

    const proxiedConnections = within(getProxiedConnectionsSection());

    expect(proxiedConnections.getByText("OpenAI")).toBeDefined();
    expect(proxiedConnections.getByText("OpenCode Go")).toBeDefined();
    expect(proxiedConnections.getByText("Anthropic")).toBeDefined();
    expect(proxiedConnections.getByText("Primary OpenAI Workspace")).toBeDefined();
    expect(proxiedConnections.getByText("Anthropic Production")).toBeDefined();
    expect(
      proxiedConnections.getByRole("combobox", { name: "OpenCode Go connection" }),
    ).toBeDefined();
  });

  it("keeps stale agent provider bindings visible so they can be removed", () => {
    const removedRows: string[] = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          agentRuntimeId: "opencode",
          availableConnections: [StoryOpenAiConnection],
          availableTargets: [StoryOpenAiTarget],
          integrationRows: [
            {
              clientId: "stale-agent-row",
              connectionId: "missing-agent-connection",
              kind: "agent",
              config: {},
            },
          ],
          onRemoveIntegrationBindingRow: (clientId) => {
            removedRows.push(clientId);
          },
        }}
      />,
    );

    const proxiedConnections = within(getProxiedConnectionsSection());

    expect(screen.getByText("Some integrations need attention")).toBeDefined();
    expect(proxiedConnections.getByText("Agent runtime connection")).toBeDefined();
    expect(proxiedConnections.getByText("Connection cannot be found")).toBeDefined();
    fireEvent.click(
      proxiedConnections.getByRole("button", { name: "Remove agent runtime connection" }),
    );
    expect(removedRows).toEqual(["stale-agent-row"]);
  });

  it("shows stale agent provider rows when the target is missing", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          agentRuntimeId: "opencode",
          availableConnections: [StoryAnthropicConnection],
          availableTargets: [StoryOpenAiTarget],
          integrationRows: [
            {
              clientId: "missing-agent-target-row",
              connectionId: StoryAnthropicConnection.id,
              kind: "agent",
              config: {},
            },
          ],
        }}
      />,
    );

    const proxiedConnections = within(getProxiedConnectionsSection());

    expect(screen.getByText("Some integrations need attention")).toBeDefined();
    expect(proxiedConnections.getByText("Agent runtime connection")).toBeDefined();
    expect(proxiedConnections.getByText("Integration no longer available.")).toBeDefined();
    expect(
      proxiedConnections.getByRole("button", { name: "Remove agent runtime connection" }),
    ).toBeDefined();
  });

  it("links disconnected connector setup to the integration add flow", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget, StoryDatadogTarget],
        }}
      />,
    );

    expect(screen.queryByText("Integrations & Tools")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add integration or tool" }));

    const dialog = screen.getByRole("dialog", { name: "Add connectors" });
    expect(within(dialog).getByText("Datadog")).toBeDefined();
    const setupLink = within(dialog).getByRole("link", { name: "Setup integration" });
    expect(setupLink.getAttribute("href")).toBe("/integrations/target-datadog/add");
    expect(setupLink.getAttribute("target")).toBe("_blank");
  });

  it("keeps stale connector bindings visible so they can be removed", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryGithubConnection, StoryJiraConnection],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget, StoryJiraTarget],
          integrationRows: [
            {
              clientId: "stale-connector-row",
              connectionId: "connection-missing",
              kind: "connector",
              config: {},
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Some integrations need attention")).toBeDefined();
    expect(
      screen.getByText("Remove or replace integrations where the connection cannot be found."),
    ).toBeDefined();
    expect(screen.getAllByText("Unknown integration").length).toBeGreaterThan(0);
    expect(screen.getByText("Connection cannot be found")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove connector" })).toBeDefined();
  });

  it("shows the same alert notice when a connector target is missing", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [
            StoryOpenAiConnection,
            StoryGithubConnection,
            StoryJiraConnection,
            StorySlackConnection,
          ],
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget, StoryJiraTarget],
          integrationRows: [
            {
              clientId: "missing-target-row",
              connectionId: StorySlackConnection.id,
              kind: "connector",
              config: {},
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Some integrations need attention")).toBeDefined();
    expect(
      screen.getByText("Remove or replace integrations where the connection cannot be found."),
    ).toBeDefined();
    expect(screen.getAllByText("Integration no longer available.").length).toBeGreaterThan(0);
  });

  it("keeps stale git connection bindings visible so they can be removed", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryJiraConnection],
          availableTargets: [StoryOpenAiTarget, StoryJiraTarget],
          integrationRows: [
            {
              clientId: "stale-git-row",
              connectionId: "missing-git-connection",
              kind: "git",
              config: {},
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Some integrations need attention")).toBeDefined();
    expect(screen.getByText("Git Connection")).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "git connection" })).toBeNull();
    expect(screen.getByText("Connection cannot be found")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove git connection" })).toBeDefined();
  });

  it("shows none in the git connection field when no git connection is selected", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableConnections: [StoryOpenAiConnection, StoryJiraConnection],
          availableTargets: [StoryOpenAiTarget, StoryJiraTarget],
        }}
      />,
    );

    expect(screen.getByRole("combobox", { name: "git connection" })).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
    expect(screen.queryByRole("switch", { name: "Sign Git commits" })).toBeNull();
    expect(screen.queryByText("Select a Git connection")).toBeNull();
  });

  it("shows the git connection dropdown with provider and connection labels", () => {
    render(<TestSandboxProfileIntegrationsSetupSection overrides={{}} />);

    fireEvent.click(screen.getByRole("combobox", { name: "git connection" }));

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("None")).toBeDefined();
    expect(within(listbox).getByText("GitHub - GitHub Production")).toBeDefined();
  });

  it("does not update commit signing when adding a Git row is rejected", async () => {
    const addedRows: Array<SandboxIntegrationBindingKind> = [];
    const gitCommitSigningConnectionChanges: Array<string | null> = [];

    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          gitCommitSigningIntegrationConnectionId: StoryGithubConnection.id,
          identityLinkedGitConnectionIds: [StoryGithubConnection.id],
          onAddIntegrationBindingRow: async (row) => {
            addedRows.push(row.kind);
            return false;
          },
          onGitCommitSigningIntegrationConnectionChange: (connectionId) => {
            gitCommitSigningConnectionChanges.push(connectionId);
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "git connection" }));
    const githubOption = screen.getByRole("option", { name: "GitHub - GitHub Production" });
    fireEvent.mouseMove(githubOption);
    fireEvent.mouseDown(githubOption, { button: 0 });
    fireEvent.mouseUp(githubOption, { button: 0 });
    fireEvent.click(githubOption, { button: 0 });

    await waitFor(() => {
      expect(addedRows).toEqual(["git"]);
    });
    expect(gitCommitSigningConnectionChanges).toEqual([]);
  });

  it("shows stale git connection rows when the target is missing", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableTargets: [StoryOpenAiTarget],
          integrationRows: [
            {
              clientId: "missing-git-target-row",
              connectionId: StoryGithubConnection.id,
              kind: "git",
              config: {},
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Some integrations need attention")).toBeDefined();
    expect(screen.getAllByText("Integration no longer available.").length).toBeGreaterThan(0);
  });

  it("dismisses save failure notices", () => {
    function DismissibleSaveFailureTest(): React.JSX.Element {
      const [saveError, setSaveError] = useState<string | null>(
        "Could not save sandbox profile integrations. Changes were not applied.",
      );

      return (
        <TestSandboxProfileIntegrationsSetupSection
          overrides={{
            integrationSaveError: saveError,
            onIntegrationSaveErrorDismiss: () => {
              setSaveError(null);
            },
          }}
        />
      );
    }

    render(<DismissibleSaveFailureTest />);

    expect(screen.getByText("Save failed")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Save failed")).toBeNull();
  });

  it("collapses paired integration load failures into one notice", () => {
    render(
      <SandboxProfileIntegrationsSetupUnavailableState
        integrationBindingsError={new Error("Could not load sandbox profile integration bindings.")}
        integrationDirectoryError={new Error("Could not load integration connections.")}
      />,
    );

    expect(screen.getByText("Could not load runtime and connections")).toBeDefined();
    expect(screen.getByText("Could not load sandbox profile integration bindings.")).toBeDefined();
    expect(screen.getByText("Could not load integration connections.")).toBeDefined();
    expect(screen.queryByText("Could not load integration bindings")).toBeNull();
  });

  it("shows agent runtime connection save errors on the field instead of a section notice", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          agentRuntimeConnectionErrorMessage: "Select an agent runtime connection.",
        }}
      />,
    );

    expect(screen.getByText("Select an agent runtime connection.")).toBeDefined();
    expect(
      screen.getByRole("combobox", { name: "OpenAI connection" }).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.queryByText("Save failed")).toBeNull();
  });
});

const StoryGcpTarget: IntegrationTargetSummary = {
  targetKey: "target-gcp",
  displayName: "Google Cloud",
  logoKey: "gcp",
  familyId: "gcp",
  variantId: "gcp-mcp",
  config: {},
  targetHealth: {
    configStatus: "valid",
  },
};

const StoryGcpConnection: IntegrationConnectionSummary = {
  id: "connection-gcp",
  displayName: "GCP Production",
  targetKey: StoryGcpTarget.targetKey,
  status: "active",
  config: {
    connection_method: "oauth2-authorization-code",
    client_id: "google-client.apps.googleusercontent.com",
  },
};

function TestSandboxProfileIntegrationsSetupSection(input: {
  overrides: Partial<SandboxProfileIntegrationsSetupSectionProps>;
}): React.JSX.Element {
  const props: SandboxProfileIntegrationsSetupSectionProps = {
    agentRuntimeId: "codex",
    availableConnections: [StoryOpenAiConnection, StoryGithubConnection],
    availableTargets: [StoryOpenAiTarget, StoryGithubTarget],
    integrationBindingsQuery: {
      isError: false,
      error: null,
      isPending: false,
    },
    integrationDirectoryQuery: {
      isError: false,
      error: null,
      isPending: false,
    },
    gitCommitSigningIntegrationConnectionId: null,
    identityLinkedGitConnectionIds: [],
    integrationRows: [],
    integrationSaveError: null,
    runtimeSettings: <div>Sandbox Runtime</div>,
    onAddIntegrationBindingRow: async () => true,
    onGitCommitSigningIntegrationConnectionChange: () => {},
    onIntegrationBindingRowChange: () => {},
    onRemoveIntegrationBindingRow: () => {},
    onIntegrationSaveErrorDismiss: () => {},
    ...input.overrides,
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SandboxProfileIntegrationsSetupSection {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function getProxiedConnectionsSection(): HTMLElement {
  const proxiedConnectionsSection = screen
    .getByRole("heading", { name: "Runtime" })
    .closest("section");
  if (proxiedConnectionsSection === null) {
    throw new Error("Expected Runtime heading to be inside a section.");
  }

  return proxiedConnectionsSection;
}

function queryEmptySectionCards(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".rounded-md.border.bg-white")).filter(
    (card) => card.textContent?.trim() === "",
  );
}
