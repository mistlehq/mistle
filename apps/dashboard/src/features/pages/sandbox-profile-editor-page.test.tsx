// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilities } from "@mistle/integrations-definitions";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  IntegrationsEditorSection,
  preserveDialogRowIdentity,
} from "./sandbox-profile-editor-page.js";

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

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

describe("IntegrationsEditorSection", () => {
  it("adds a binding into the selected section via dialog", async () => {
    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: "Add" });
    fireEvent.click(addButtons[0]!);

    expect(screen.getByRole("heading", { name: "Add binding" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add binding" }));

    expect(await screen.findByRole("button", { name: "Edit binding" })).toBeDefined();
    expect(await screen.findByText("target-agent")).toBeDefined();
    expect(await screen.findByText("Primary OpenAI Workspace")).toBeDefined();
  });

  it("lists distinct connection display names for duplicate provider connections", async () => {
    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    const addButtons = screen.getAllByRole("button", { name: "Add" });
    fireEvent.click(addButtons[0]!);
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
