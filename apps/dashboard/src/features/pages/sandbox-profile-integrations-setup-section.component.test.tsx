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
  });

  it("shows the git connection dropdown with provider and connection labels", () => {
    render(<TestSandboxProfileIntegrationsSetupSection overrides={{}} />);

    fireEvent.click(screen.getByRole("combobox", { name: "git connection" }));

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("None")).toBeDefined();
    expect(within(listbox).getByText("GitHub - GitHub Production")).toBeDefined();
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
