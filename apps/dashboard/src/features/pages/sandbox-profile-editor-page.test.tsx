// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions/openai";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  IntegrationsEditorSection,
  preserveDialogRowIdentity,
} from "./integrations-editor-section.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

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
        binding_capabilities_by_connection_method:
          createOpenAiRawBindingCapabilitiesByConnectionMethod(),
      },
      targetHealth: {
        configStatus: "valid",
      },
    };
  }

  if (kind === "connector") {
    return {
      targetKey,
      displayName: targetKey,
      familyId: "linear",
      variantId: "linear-default",
      config: {},
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
    {
      id: "conn-connector",
      displayName: "Linear Workspace",
      targetKey: "target-connector",
      status: "active",
      config: {
        connection_method: "api-key",
      },
    },
  ];
  const targets: readonly IntegrationTargetSummary[] = [
    createTarget("target-agent", "agent"),
    createTarget("target-agent-2", "agent"),
    createTarget("target-git", "git"),
    createTarget("target-connector", "connector"),
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
      isSubmittingIntegrationBindings={false}
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

function getSectionContainer(sectionTitle: string): HTMLElement {
  const sectionHeading = screen.getAllByRole("heading", { name: sectionTitle })[0];

  if (sectionHeading === undefined) {
    throw new Error(`Could not resolve section heading for ${sectionTitle}.`);
  }

  const sectionContainer = sectionHeading.closest("section");

  if (sectionContainer === null || sectionContainer === undefined) {
    throw new Error(`Could not resolve section container for ${sectionTitle}.`);
  }

  return sectionContainer;
}

function getSectionAddButton(sectionTitle: string): HTMLButtonElement {
  return within(getSectionContainer(sectionTitle)).getByRole("button", { name: "Add" });
}

function getOpenDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

describe("IntegrationsEditorSection", () => {
  it("adds a binding into the selected section via dialog", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Agent Harness"));

    expect(screen.getByRole("heading", { name: "Add agent harness" })).toBeDefined();

    const dialog = getOpenDialog();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Add binding connection" }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Primary OpenAI Workspace"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const agentSection = getSectionContainer("Agent Harness");
      expect(within(agentSection).getByRole("button", { name: "Edit binding" })).toBeDefined();
      expect(within(agentSection).getByText("target-agent")).toBeDefined();
      expect(within(agentSection).getByText("Primary OpenAI Workspace")).toBeDefined();
    });
  }, 10000);

  it("requires explicitly selecting a connection before adding a binding", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Agent Harness"));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    expect(screen.getByText("Select a connection to add this binding.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Edit binding" })).toBeNull();
  });

  it("defaults the binding connection when only one option is available", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Git Providers"));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const gitProvidersSection = getSectionContainer("Git Providers");
      expect(
        within(gitProvidersSection).getByRole("button", { name: "Edit binding" }),
      ).toBeDefined();
      expect(within(gitProvidersSection).getByText("target-git")).toBeDefined();
    });
  });

  it("lists distinct connection display names for duplicate provider connections", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Agent Harness"));
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );

    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).getByText("Primary OpenAI Workspace")).toBeDefined();
    expect(within(listbox).getByText("Backup OpenAI Workspace")).toBeDefined();
  });

  it("renders connector bindings as inline tool switches without an edit action", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Connectors"));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add connector" })).toBeNull();
    });

    const connectorsSection = getSectionContainer("Connectors");
    const linearMcpCheckboxes = within(connectorsSection).getAllByRole("checkbox", {
      name: /Linear MCP/,
    });
    const removeBindingButtons = within(connectorsSection).getAllByRole("button", {
      name: "Remove binding",
    });
    const linearMcpCheckbox = linearMcpCheckboxes[0];
    if (linearMcpCheckbox === undefined) {
      throw new Error("Expected at least one Linear MCP checkbox.");
    }

    expect(within(connectorsSection).queryByRole("button", { name: "Edit binding" })).toBeNull();
    expect(removeBindingButtons[0]).toBeDefined();
    expect(linearMcpCheckbox.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(linearMcpCheckbox);

    await waitFor(() => {
      expect(linearMcpCheckbox.getAttribute("aria-checked")).toBe("true");
    });
  });

  it("disables adding another agent harness after one is assigned", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getSectionAddButton("Agent Harness"));
    const dialog = getOpenDialog();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Add binding connection" }));
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText("Primary OpenAI Workspace"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(getSectionAddButton("Agent Harness").hasAttribute("disabled")).toBe(true);
    });

    expect(
      screen.queryByText("Only one agent harness can be assigned to a sandbox profile."),
    ).toBeNull();
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
