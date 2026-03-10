// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
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
}): ReturnType<typeof render> {
  return render(
    <SandboxProfileBindingConfigEditor
      availableConnections={input.connections}
      availableTargets={input.targets}
      onIntegrationBindingRowChange={() => {}}
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
        binding_capabilities: createOpenAiRawBindingCapabilities(),
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
        auth_scheme: "api-key",
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

    expect(screen.getByText("Default model")).toBeDefined();
    expect(screen.getByText("Reasoning effort")).toBeDefined();
    expect(screen.getByText("Additional instructions")).toBeDefined();
    expect(screen.getByLabelText("Default model")).toBeDefined();
    expect(screen.getByLabelText("Reasoning effort")).toBeDefined();
    expect(screen.getByLabelText("Additional instructions")).toBeDefined();
    expect(container.querySelectorAll('[data-slot="select-trigger"]').length).toBe(2);
    expect(screen.getAllByText("*").length).toBe(2);
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("removes additional instructions from config when the textarea is cleared", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-openai",
      displayName: "OpenAI",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities: createOpenAiRawBindingCapabilities(),
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
        auth_scheme: "api-key",
      },
    };
    const row: SandboxProfileBindingEditorRow = {
      clientId: "row-openai",
      connectionId: connection.id,
      kind: "agent",
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
        additionalInstructions: "Prefer concise answers.",
      },
    };
    const updates: Array<Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>> = [];

    render(
      <SandboxProfileBindingConfigEditor
        availableConnections={[connection]}
        availableTargets={[target]}
        onIntegrationBindingRowChange={(_clientId, changes) => {
          updates.push(changes);
        }}
        row={row}
      />,
    );

    const additionalInstructionsField = screen
      .getAllByRole("textbox", {
        name: "Additional instructions",
      })
      .find((field) => field instanceof HTMLTextAreaElement && field.value.length > 0);
    if (additionalInstructionsField === undefined) {
      throw new Error("Expected Additional instructions textarea.");
    }

    fireEvent.change(additionalInstructionsField, {
      target: { value: "   " },
    });

    expect(updates.at(-1)?.config).toEqual({
      runtime: "codex-cli",
      defaultModel: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
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
        auth_scheme: "oauth",
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
      uiSchema: {
        repositories: {
          "ui:widget": "integration-resource-string-array",
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
      },
    });
  });
});
