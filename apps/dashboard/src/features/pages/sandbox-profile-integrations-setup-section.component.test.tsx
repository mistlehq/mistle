// @vitest-environment jsdom

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
  it("links disconnected connector setup to the integration add flow", () => {
    render(
      <TestSandboxProfileIntegrationsSetupSection
        overrides={{
          availableTargets: [StoryOpenAiTarget, StoryGithubTarget, StoryDatadogTarget],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add more connectors" }));

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
    expect(screen.getByText("Unknown integration")).toBeDefined();
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

      const gitProviderRow = screen
        .getByText("No git providers setup")
        .closest('[data-slot="responsive-field-list-row"]');
      expect(gitProviderRow).not.toBeNull();
      const gitProviderConnectionCell = gitProviderRow?.querySelector(
        '[data-column-key="connection"]',
      );
      expect(gitProviderConnectionCell?.classList.contains("hidden")).toBe(true);

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
    onAddIntegrationBindingRow: async () => true,
    onIntegrationBindingRowChange: () => {},
    onRemoveIntegrationBindingRow: () => {},
    onIntegrationSaveErrorDismiss: () => {},
    ...input.overrides,
  };

  return (
    <MemoryRouter>
      <SandboxProfileIntegrationsSetupSection {...props} />
    </MemoryRouter>
  );
}
