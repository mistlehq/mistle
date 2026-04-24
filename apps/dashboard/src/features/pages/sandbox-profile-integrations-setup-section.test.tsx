// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
} from "./integrations-editor-section-story-support.js";
import { SandboxProfileIntegrationsSetupSection } from "./sandbox-profile-integrations-setup-section.js";

afterEach(() => {
  cleanup();
});

describe("SandboxProfileIntegrationsSetupSection", () => {
  it("keeps add connectors available for disconnected connector targets", () => {
    async function handleAddIntegrationBindingRow(): Promise<boolean> {
      return true;
    }

    render(
      <MemoryRouter>
        <SandboxProfileIntegrationsSetupSection
          availableConnections={[StoryOpenAiConnection, StoryGithubConnection]}
          availableTargets={[StoryOpenAiTarget, StoryGithubTarget, StoryDatadogTarget]}
          integrationBindingsQuery={{
            isError: false,
            error: null,
            isPending: false,
          }}
          integrationDirectoryQuery={{
            isError: false,
            error: null,
            isPending: false,
          }}
          integrationRows={[]}
          integrationSaveError={null}
          onAddIntegrationBindingRow={handleAddIntegrationBindingRow}
          onIntegrationBindingRowChange={() => {}}
          onRemoveIntegrationBindingRow={() => {}}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add more connectors" }));

    const dialog = screen.getByRole("dialog", { name: "Add connectors" });
    expect(within(dialog).getByText("Datadog")).toBeDefined();
    const setupLink = within(dialog).getByRole("link", { name: "Setup integration" });
    expect(setupLink.getAttribute("href")).toBe("/integrations/target-datadog");
    expect(setupLink.getAttribute("target")).toBe("_blank");
  });

  it("keeps stale connector bindings visible so they can be removed", () => {
    render(
      <MemoryRouter>
        <SandboxProfileIntegrationsSetupSection
          availableConnections={[StoryOpenAiConnection, StoryGithubConnection, StoryJiraConnection]}
          availableTargets={[StoryOpenAiTarget, StoryGithubTarget, StoryJiraTarget]}
          integrationBindingsQuery={{
            isError: false,
            error: null,
            isPending: false,
          }}
          integrationDirectoryQuery={{
            isError: false,
            error: null,
            isPending: false,
          }}
          integrationRows={[
            {
              clientId: "stale-connector-row",
              connectionId: "connection-missing",
              kind: "connector",
              config: {},
            },
          ]}
          integrationSaveError={null}
          onAddIntegrationBindingRow={async () => true}
          onIntegrationBindingRowChange={() => {}}
          onRemoveIntegrationBindingRow={() => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Unknown connector")).toBeDefined();
    expect(screen.getByText("Connection no longer available.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove connector" })).toBeDefined();
  });
});
