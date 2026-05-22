// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  resolveBindingConfigSummaryItems,
  resolveBindingConfigUiModel,
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

function renderBindingEditor(input: {
  row: SandboxProfileBindingEditorRow;
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
  disabled?: boolean | undefined;
  onIntegrationBindingRowChange?: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
}): ReturnType<typeof render> {
  return render(
    <SandboxProfileBindingConfigEditor
      availableConnections={input.connections}
      availableTargets={input.targets}
      disabled={input.disabled}
      onIntegrationBindingRowChange={input.onIntegrationBindingRowChange ?? (() => {})}
      row={input.row}
    />,
  );
}

describe("SandboxProfileBindingConfigEditor", () => {
  it("renders OpenAI binding config with packages/ui select triggers", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-openai",
      displayName: "OpenAI",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-openai",
      displayName: "Primary OpenAI Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-openai",
      connectionId: connection.id,
      kind: "agent",
      config: {},
    };

    const { container } = renderBindingEditor({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(screen.queryByLabelText("Default model")).toBeNull();
    expect(screen.queryByLabelText("Reasoning effort")).toBeNull();
    expect(screen.queryByLabelText("Agent Instructions")).toBeNull();
    expect(screen.queryByText("runtime")).toBeNull();
    expect(screen.queryByText("config")).toBeNull();
    expect(screen.queryByText("model")).toBeNull();
    expect(screen.queryByText("options")).toBeNull();

    expect(container.querySelectorAll('[data-slot="select-trigger"]').length).toBe(0);
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("resolves GitHub binding config to a resource-backed repository widget", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-github",
      displayName: "GitHub",
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-github",
      displayName: "GitHub Production",
      targetKey: target.targetKey,
      status: "active",
      resources: [
        {
          kind: "repository",
          selectionMode: "multi",
          count: 24,
          syncState: "ready",
          lastSyncedAt: "2026-03-09T12:00:00.000Z",
        },
      ],
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "12345",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-github",
      connectionId: connection.id,
      kind: "git",
      config: {},
    };

    const resolvedUiModel = resolveBindingConfigUiModel({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(resolvedUiModel).toMatchObject({
      mode: "form",
      schema: {
        properties: {
          tools: {
            title: "Tools",
            default: ["github-cli"],
          },
        },
      },
      uiSchema: {
        repositories: {
          "ui:widget": "integration-resource-picker",
          "ui:options": {
            connectionId: "connection-github",
            kind: "repository",
            title: "Repositories",
            searchPlaceholder: "Search repositories",
            emptyMessage: "No repositories available for this connection.",
            refreshLabel: "Refresh repositories",
            resourceSummary: {
              kind: "repository",
              selectionMode: "multi",
              count: 24,
              syncState: "ready",
              lastSyncedAt: "2026-03-09T12:00:00.000Z",
            },
          },
        },
        tools: {
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      },
    });
  });

  it("derives binding summary items from the shared config model", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-openai",
      displayName: "OpenAI",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
      },
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-openai",
      displayName: "Primary OpenAI Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-openai",
      connectionId: connection.id,
      kind: "agent",
      config: {},
    };

    expect(
      resolveBindingConfigSummaryItems({
        row,
        connections: [connection],
        targets: [target],
        maxItems: Number.POSITIVE_INFINITY,
      }),
    ).toEqual([]);
  });

  it("renders array-backed tool selections with human-readable labels", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-github",
      displayName: "GitHub",
      familyId: "github",
      variantId: "github-cloud",
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-github",
      displayName: "GitHub Production",
      targetKey: target.targetKey,
      status: "active",
      resources: [
        {
          kind: "repository",
          selectionMode: "multi",
          count: 24,
          syncState: "ready",
          lastSyncedAt: "2026-03-09T12:00:00.000Z",
        },
      ],
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: "12345",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-github",
      connectionId: connection.id,
      kind: "git",
      config: {
        repositories: ["mistlehq/mistle"],
        tools: ["github-cli"],
      },
    };

    expect(
      resolveBindingConfigSummaryItems({
        row,
        connections: [connection],
        targets: [target],
      }),
    ).toEqual([
      {
        label: "Repositories",
        value: "mistlehq/mistle",
      },
      {
        label: "Tools",
        value: "GitHub CLI",
      },
    ]);
  });

  it("renders Jira tool selections with human-readable labels", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-jira",
      displayName: "Jira",
      familyId: "jira",
      variantId: "jira-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-jira",
      displayName: "Jira Production",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-jira",
      connectionId: connection.id,
      kind: "connector",
      config: {
        tools: ["jira-cli"],
      },
    };

    expect(
      resolveBindingConfigSummaryItems({
        row,
        connections: [connection],
        targets: [target],
      }),
    ).toEqual([
      {
        label: "Tools",
        value: "Jira CLI",
      },
    ]);
  });

  it("renders Linear MCP tool selections with human-readable labels", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-linear",
      displayName: "Linear",
      familyId: "linear",
      variantId: "linear-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-linear",
      displayName: "Linear Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-linear",
      connectionId: connection.id,
      kind: "connector",
      config: {
        tools: ["linear-mcp"],
      },
    };

    expect(
      resolveBindingConfigSummaryItems({
        row,
        connections: [connection],
        targets: [target],
      }),
    ).toEqual([
      {
        label: "Tools",
        value: "Linear MCP",
      },
    ]);
  });

  it("renders an explicit empty tool summary when no Linear tools are selected", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-linear",
      displayName: "Linear",
      familyId: "linear",
      variantId: "linear-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-linear",
      displayName: "Linear Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-linear",
      connectionId: connection.id,
      kind: "connector",
      config: {},
    };

    expect(
      resolveBindingConfigSummaryItems({
        row,
        connections: [connection],
        targets: [target],
      }),
    ).toEqual([
      {
        label: "Tools",
        value: "None",
      },
    ]);
  });

  it("resolves Jira binding config to an optional tools checkbox list", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-jira",
      displayName: "Jira",
      familyId: "jira",
      variantId: "jira-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-jira",
      displayName: "Jira Production",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-jira",
      connectionId: connection.id,
      kind: "connector",
      config: {},
    };

    const resolvedUiModel = resolveBindingConfigUiModel({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(resolvedUiModel).toMatchObject({
      mode: "form",
      schema: {
        properties: {
          tools: {
            title: "Tools",
            default: ["jira-cli"],
          },
        },
      },
      uiSchema: {
        tools: {
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      },
    });
  });

  it("renders the Jira tool checkbox with the display label", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-jira",
      displayName: "Jira",
      familyId: "jira",
      variantId: "jira-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-jira",
      displayName: "Jira Production",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-jira",
      connectionId: connection.id,
      kind: "connector",
      config: {},
    };

    renderBindingEditor({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(screen.getByText("Jira CLI")).toBeDefined();
    expect(screen.queryByText("jira-cli")).toBeNull();
    const jiraCliCheckbox = screen.getByRole("checkbox", { name: "Jira CLI" });
    expect(jiraCliCheckbox.getAttribute("aria-checked")).toBe("true");
  });

  it("resolves Linear binding config to an optional tools checkbox list", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-linear",
      displayName: "Linear",
      familyId: "linear",
      variantId: "linear-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-linear",
      displayName: "Linear Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-linear",
      connectionId: connection.id,
      kind: "connector",
      config: {},
    };

    const resolvedUiModel = resolveBindingConfigUiModel({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(resolvedUiModel).toMatchObject({
      mode: "form",
      schema: {
        properties: {
          tools: {
            title: "Tools",
            default: [],
          },
        },
      },
      uiSchema: {
        tools: {
          "ui:widget": "checkboxes",
          "ui:options": {
            inline: false,
          },
        },
      },
    });
  });

  it("renders the Linear MCP checkbox with the display label", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-linear",
      displayName: "Linear",
      familyId: "linear",
      variantId: "linear-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-linear",
      displayName: "Linear Workspace",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-linear",
      connectionId: connection.id,
      kind: "connector",
      config: {},
    };

    renderBindingEditor({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(screen.getByText("Linear MCP")).toBeDefined();
    expect(screen.queryByText("linear-mcp")).toBeNull();
    const linearMcpCheckbox = screen.getByRole("checkbox", { name: "Linear MCP" });
    expect(linearMcpCheckbox.getAttribute("aria-checked")).toBe("false");
  });

  it("does not reset unsupported config while disabled", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-jira",
      displayName: "Jira",
      familyId: "jira",
      variantId: "jira-default",
      config: {},
      targetHealth: {
        configStatus: "valid",
      },
    };
    const connection: IntegrationConnectionSummary = {
      id: "connection-jira",
      displayName: "Jira Production",
      targetKey: target.targetKey,
      status: "active",
      config: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-jira",
      connectionId: connection.id,
      kind: "connector",
      config: {
        unsupported: true,
      },
    };
    const rowChanges: Array<{
      clientId: string;
      changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>;
    }> = [];

    renderBindingEditor({
      row,
      connections: [connection],
      targets: [target],
      disabled: true,
      onIntegrationBindingRowChange: (clientId, changes) => {
        rowChanges.push({ clientId, changes });
      },
    });

    const resetButton = screen.getByRole("button", { name: "Reset config" });
    if (!(resetButton instanceof HTMLButtonElement)) {
      throw new Error("Expected Reset config to render as a button.");
    }
    expect(resetButton.disabled).toBe(true);

    fireEvent.click(resetButton);

    expect(rowChanges).toEqual([]);
  });
});
