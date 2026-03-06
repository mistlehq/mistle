// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
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
    expect(screen.getByLabelText("Default model")).toBeDefined();
    expect(screen.getByLabelText("Reasoning effort")).toBeDefined();
    expect(container.querySelectorAll('[data-slot="select-trigger"]').length).toBe(2);
    expect(screen.getAllByText("*").length).toBe(2);
  });

  it("renders GitHub binding config with packages/ui input widget", () => {
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
      targetKey: target.targetKey,
      status: "active",
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

    const { container } = renderBindingEditor({
      row,
      connections: [connection],
      targets: [target],
    });

    expect(screen.getByText("Repositories")).toBeDefined();
    expect(screen.getByLabelText("Repositories")).toBeDefined();
    expect(screen.getByPlaceholderText("owner/repository, owner/another-repository")).toBeDefined();
    expect(container.querySelectorAll('[data-slot="input"]').length).toBe(1);
  });
});
