// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  IntegrationsEditorSection,
  preserveDialogRowIdentity,
} from "./sandbox-profile-editor-page.js";

function createTarget(
  targetKey: string,
  kind: "agent" | "git" | "connector",
): IntegrationTargetSummary {
  if (kind === "agent") {
    return {
      targetKey,
      displayName: targetKey,
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
  }

  return {
    targetKey,
    displayName: targetKey,
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
}

function Harness(): React.JSX.Element {
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>([]);
  const [nextId, setNextId] = useState(1);

  const connections: readonly IntegrationConnectionSummary[] = [
    {
      id: "conn-agent",
      displayName: "Primary OpenAI Workspace",
      targetKey: "target-agent",
      status: "active",
    },
    {
      id: "conn-agent-2",
      displayName: "Backup OpenAI Workspace",
      targetKey: "target-agent-2",
      status: "active",
    },
    {
      id: "conn-git",
      displayName: "GitHub Production",
      targetKey: "target-git",
      status: "active",
    },
  ];
  const targets: readonly IntegrationTargetSummary[] = [
    createTarget("target-agent", "agent"),
    createTarget("target-agent-2", "agent"),
    createTarget("target-git", "git"),
  ];

  return (
    <IntegrationsEditorSection
      availableConnections={connections}
      availableTargets={targets}
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
      integrationRowErrorsByClientId={{}}
      integrationRows={rows}
      integrationSaveError={null}
      integrationSaveSuccess={false}
      isSavingIntegrationBindings={false}
      onAddIntegrationBindingRow={async (input) => {
        const clientId = `row-${String(nextId)}`;
        setRows((currentRows) => [
          ...currentRows,
          {
            clientId,
            connectionId: input.connectionId,
            kind: input.kind,
            config: input.config,
          },
        ]);
        setNextId((current) => current + 1);
        return true;
      }}
      onIntegrationBindingRowChange={(clientId, changes) => {
        setRows((currentRows) =>
          currentRows.map((row) => (row.clientId === clientId ? { ...row, ...changes } : row)),
        );
      }}
      onRemoveIntegrationBindingRow={(clientId) => {
        setRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
      }}
      resolveSelectedConnectionDisplayName={(row) => row.connectionId}
    />
  );
}

function getSectionAddButton(sectionTitle: string): HTMLButtonElement {
  const sectionHeading = screen.getAllByRole("heading", { name: sectionTitle })[0];

  if (sectionHeading === undefined) {
    throw new Error(`Could not resolve section heading for ${sectionTitle}.`);
  }

  const sectionContainer = sectionHeading.parentElement?.parentElement;

  if (sectionContainer === null || sectionContainer === undefined) {
    throw new Error(`Could not resolve section container for ${sectionTitle}.`);
  }

  return within(sectionContainer).getByRole("button", { name: "Add" });
}

afterEach(() => {
  cleanup();
});

describe("IntegrationsEditorSection", () => {
  it("adds a binding into the selected section via dialog", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Agent Bindings"));

    expect(screen.getByRole("heading", { name: "Add binding" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add binding" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Edit binding" })).toBeDefined();
      expect(screen.getByText("target-agent")).toBeDefined();
      expect(screen.getByText("Primary OpenAI Workspace")).toBeDefined();
    });
  }, 10000);

  it("lists distinct connection display names for duplicate provider connections", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Agent Bindings"));
    fireEvent.click(screen.getByRole("combobox", { name: "Add binding connection" }));

    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).getByText("Primary OpenAI Workspace")).toBeDefined();
    expect(within(listbox).getByText("Backup OpenAI Workspace")).toBeDefined();
  });

  it("preserves edited row identity when changing connection", () => {
    const preserved = preserveDialogRowIdentity({
      currentRow: {
        clientId: "row-99",
        id: "binding-99",
        connectionId: "conn-agent",
        kind: "agent",
        config: { model: "gpt-5.3-codex" },
      },
      nextDraftRow: {
        clientId: "dialog-draft",
        connectionId: "conn-agent-2",
        kind: "agent",
        config: { model: "gpt-5.4-codex" },
      },
    });

    expect(preserved.clientId).toBe("row-99");
    expect(preserved.id).toBe("binding-99");
    expect(preserved.connectionId).toBe("conn-agent-2");
    expect(preserved.config).toStrictEqual({ model: "gpt-5.4-codex" });
  });
});
