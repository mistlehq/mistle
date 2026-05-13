// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, useState } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import {
  StoryDatadogTarget,
  StoryGithubConnection,
  StoryGithubTarget,
  StoryJiraConnection,
  StoryJiraTarget,
  StoryOpenAiConnection,
  StoryOpenAiTarget,
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";

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

  it("labels proxied connection service rows with their integration names", () => {
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

    const proxiedConnectionsSection = screen
      .getByRole("heading", { name: "Proxied Connections" })
      .closest("section");
    if (proxiedConnectionsSection === null) {
      throw new Error("Expected Proxied Connections heading to be inside a section.");
    }
    const proxiedConnections = within(proxiedConnectionsSection);

    expect(proxiedConnections.getAllByText("Service").length).toBeGreaterThan(0);
    expect(proxiedConnections.getAllByText("Credential Connection").length).toBeGreaterThan(0);
    expect(proxiedConnections.getByText("OpenAI")).toBeDefined();
    expect(proxiedConnections.getByText("GitHub")).toBeDefined();
    expect(proxiedConnections.getByText("Jira")).toBeDefined();
    expect(proxiedConnections.getByText("Primary OpenAI Workspace")).toBeDefined();
    expect(proxiedConnections.getByText("GitHub Production")).toBeDefined();
    expect(proxiedConnections.getByText("Jira Production")).toBeDefined();
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

  it("keeps stale git provider bindings visible so they can be removed", () => {
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
    expect(screen.getByText("None")).toBeDefined();
    expect(screen.queryByRole("combobox", { name: "git provider integration" })).toBeNull();
    expect(screen.getByText("Connection cannot be found")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove git provider" })).toBeDefined();
  });

  it("shows a static empty state when no git provider integrations are available", () => {
    for (const readOnly of [false, true]) {
      const { unmount } = render(
        <TestSandboxProfileIntegrationsSetupSection
          overrides={{
            availableConnections: [StoryOpenAiConnection, StoryJiraConnection],
            availableTargets: [StoryOpenAiTarget, StoryJiraTarget],
            readOnly,
          }}
        />,
      );

      expect(screen.getByText("No git providers setup")).toBeDefined();
      expect(screen.queryByRole("combobox", { name: "git provider integration" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "git provider connection" })).toBeNull();

      unmount();
    }
  });

  it("shows stale git provider rows when the target is missing", () => {
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
});

function TestSandboxProfileIntegrationsSetupSection(input: {
  overrides: Partial<SandboxProfileIntegrationsSetupSectionProps>;
}): React.JSX.Element {
  const props: SandboxProfileIntegrationsSetupSectionProps = {
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
    integrationRows: [],
    integrationSaveError: null,
    runtimeSettings: <div>Sandbox Runtime</div>,
    onAddIntegrationBindingRow: async () => true,
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

function queryEmptySectionCards(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".rounded-md.border.bg-white")).filter(
    (card) => card.textContent?.trim() === "",
  );
}
