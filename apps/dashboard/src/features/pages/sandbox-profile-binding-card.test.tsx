// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions/openai";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxProfileBindingCard } from "./sandbox-profile-binding-card.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

describe("SandboxProfileBindingCard", () => {
  it("renders all agent harness config fields inline on the card", () => {
    const target: IntegrationTargetSummary = {
      targetKey: "target-openai",
      displayName: "OpenAI",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com",
        binding_capabilities_by_connection_method:
          createOpenAiRawBindingCapabilitiesByConnectionMethod(),
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
      config: {
        runtime: {
          runtimeId: "codex",
          config: {},
        },
        model: {
          defaultModel: "gpt-5.3-codex",
          options: {
            reasoningEffort: "medium",
            additionalInstructions: "Prefer concise answers.",
          },
        },
      },
    };

    render(
      <SandboxProfileBindingCard
        availableConnections={[connection]}
        availableTargets={[target]}
        onEdit={() => {}}
        onRemove={() => {}}
        row={row}
      />,
    );

    expect(screen.getByText("Default model")).toBeDefined();
    expect(screen.getByText("gpt-5.3-codex")).toBeDefined();
    expect(screen.getByText("Reasoning effort")).toBeDefined();
    expect(screen.getByText("Medium")).toBeDefined();
    expect(screen.getByText("Agent Instructions")).toBeDefined();
    expect(screen.getByText("Prefer concise answers.")).toBeDefined();
  });

  it("renders all git provider config fields inline on the card", () => {
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

    render(
      <SandboxProfileBindingCard
        availableConnections={[connection]}
        availableTargets={[target]}
        onEdit={() => {}}
        onRemove={() => {}}
        row={row}
      />,
    );

    expect(screen.getByText("Repositories")).toBeDefined();
    expect(screen.getByText("mistlehq/mistle")).toBeDefined();
    expect(screen.getByText("Tools")).toBeDefined();
    expect(screen.getByText("GitHub CLI")).toBeDefined();
  });
});
