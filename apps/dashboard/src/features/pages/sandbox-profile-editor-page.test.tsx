// @vitest-environment jsdom

import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions/openai";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

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

afterEach(() => {
  cleanup();
});

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

function Harness(input?: {
  onHasUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
}): React.JSX.Element {
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>([]);
  const [nextId, setNextId] = useState(1);

  const connections: readonly IntegrationConnectionSummary[] = [
    {
      id: "conn-agent",
      displayName: "Primary OpenAI Workspace",
      targetKey: "target-agent",
      status: "active",
      config: {
        connection_method: "api-key",
      },
    },
    {
      id: "conn-agent-2",
      displayName: "Backup OpenAI Workspace",
      targetKey: "target-agent-2",
      status: "active",
      config: {
        connection_method: "api-key",
      },
    },
    {
      id: "conn-git",
      displayName: "GitHub Production",
      targetKey: "target-git",
      status: "active",
      config: {
        connection_method: "api-key",
      },
    },
    {
      id: "conn-git-2",
      displayName: "GitHub Backup",
      targetKey: "target-git-2",
      status: "active",
      config: {
        connection_method: "api-key",
      },
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
    createTarget("target-git-2", "git"),
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
      {...(input?.onHasUnsavedChangesChange === undefined
        ? {}
        : { onHasUnsavedChangesChange: input.onHasUnsavedChangesChange })}
    />
  );
}

function getActiveTabPanel(): HTMLElement {
  const activeTabPanel = screen
    .getAllByRole("tabpanel", { hidden: true })
    .find((panel) => panel.getAttribute("hidden") !== "");

  if (activeTabPanel === undefined) {
    throw new Error("Could not resolve the active integrations tab panel.");
  }

  return activeTabPanel;
}

function getVisibleAddButton(): HTMLButtonElement {
  const addButton = screen.getAllByRole("button", { name: "Add" })[0];
  if (addButton === undefined) {
    throw new Error("Could not resolve an Add button.");
  }

  return addButton as HTMLButtonElement;
}

function activateIntegrationsTab(tabLabel: "Agent Harness" | "Git Provider" | "Connectors"): void {
  fireEvent.click(screen.getByRole("tab", { name: tabLabel }));
}

function getOpenDialog(): HTMLElement {
  return screen.getByRole("dialog");
}

describe("IntegrationsEditorSection", () => {
  it("shows an enabled add action for an empty agent harness section", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    const addButton = getVisibleAddButton();

    expect(addButton.hasAttribute("disabled")).toBe(false);
    expect(within(getActiveTabPanel()).queryByRole("combobox", { name: "Connection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit binding" })).toBeNull();
  });

  it("adds an agent harness binding from the add dialog", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText(/Primary OpenAI Workspace/));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const agentSection = getActiveTabPanel();
      const connectionCombobox = within(agentSection).getByRole("combobox", {
        name: "Connection",
      });
      expect(within(agentSection).queryByRole("button", { name: "Edit binding" })).toBeNull();
      expect(connectionCombobox).toBeDefined();
      expect(connectionCombobox.textContent).toContain("Primary OpenAI Workspace");
      expect(within(agentSection).queryByRole("button", { name: "Remove binding" })).toBeNull();
    });
  }, 10000);

  it("adds a git provider binding from the add dialog", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    activateIntegrationsTab("Git Provider");
    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText(/GitHub Production/));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const gitProvidersSection = getActiveTabPanel();
      const connectionCombobox = within(gitProvidersSection).getByRole("combobox", {
        name: "Connection",
      });
      expect(
        within(gitProvidersSection).queryByRole("button", { name: "Edit binding" }),
      ).toBeNull();
      expect(connectionCombobox).toBeDefined();
      expect(connectionCombobox.textContent).toContain("GitHub Production");
      expect(within(gitProvidersSection).getByText("Repositories")).toBeDefined();
      expect(within(gitProvidersSection).getByText("GitHub CLI")).toBeDefined();
    });
  });

  it("lists distinct connection display names for duplicate provider connections", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).getByText(/Primary OpenAI Workspace/)).toBeDefined();
    expect(within(listbox).getByText(/Backup OpenAI Workspace/)).toBeDefined();
  });

  it("renders connector bindings as inline tool switches without an edit action", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    activateIntegrationsTab("Connectors");
    fireEvent.click(getVisibleAddButton());
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add connector" })).toBeNull();
    });

    const connectorsSection = getActiveTabPanel();
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

  it("removes the add action for agent harness after one is assigned", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText(/Primary OpenAI Workspace/));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const agentSection = getActiveTabPanel();
      expect(within(agentSection).getByRole("combobox", { name: "Connection" })).toBeDefined();
      expect(within(agentSection).queryByRole("button", { name: "Edit binding" })).toBeNull();
    });

    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("removes the add action for git providers after one is assigned", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    activateIntegrationsTab("Git Provider");
    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText(/GitHub Production/));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      const gitProvidersSection = getActiveTabPanel();
      expect(
        within(gitProvidersSection).queryByRole("button", { name: "Edit binding" }),
      ).toBeNull();
      expect(
        within(gitProvidersSection).getByRole("combobox", { name: "Connection" }),
      ).toBeDefined();
    });

    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("autosaves agent harness edits inline without save or cancel actions", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    let listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText(/Primary OpenAI Workspace/));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(
        within(getActiveTabPanel()).getByRole("combobox", { name: "Connection" }),
      ).toBeDefined();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Save" })).toBeNull();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    fireEvent.change(
      within(getActiveTabPanel()).getByRole("textbox", { name: "Agent Instructions" }),
      {
        target: { value: "Use the backup workspace when needed." },
      },
    );

    await waitFor(() => {
      const agentInstructions = within(getActiveTabPanel()).getByRole("textbox", {
        name: "Agent Instructions",
      }) as HTMLTextAreaElement;
      expect(agentInstructions.value).toBe("Use the backup workspace when needed.");
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Save" })).toBeNull();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    fireEvent.change(
      within(getActiveTabPanel()).getByRole("textbox", { name: "Agent Instructions" }),
      {
        target: { value: "" },
      },
    );

    await waitFor(() => {
      const agentInstructions = within(getActiveTabPanel()).getByRole("textbox", {
        name: "Agent Instructions",
      }) as HTMLTextAreaElement;
      expect(agentInstructions.value).toBe("");
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Save" })).toBeNull();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    });
  });

  it("autosaves git provider edits inline without save or cancel actions", async () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    activateIntegrationsTab("Git Provider");
    fireEvent.click(getVisibleAddButton());
    fireEvent.click(
      within(getOpenDialog()).getByRole("combobox", { name: "Add binding connection" }),
    );
    const listbox = await screen.findByRole("listbox");
    fireEvent.click(within(listbox).getByText(/GitHub Production/));
    fireEvent.click(within(getOpenDialog()).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(within(getActiveTabPanel()).getAllByRole("checkbox").length).toBeGreaterThan(0);
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Save" })).toBeNull();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    fireEvent.click(within(getActiveTabPanel()).getAllByRole("checkbox")[0] as HTMLElement);

    await waitFor(() => {
      const firstCheckbox = within(getActiveTabPanel()).getAllByRole("checkbox")[0];
      expect(firstCheckbox?.getAttribute("aria-checked")).toBe("false");
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Save" })).toBeNull();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    fireEvent.click(within(getActiveTabPanel()).getAllByRole("checkbox")[0] as HTMLElement);

    await waitFor(() => {
      const firstCheckbox = within(getActiveTabPanel()).getAllByRole("checkbox")[0];
      expect(firstCheckbox?.getAttribute("aria-checked")).toBe("true");
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Save" })).toBeNull();
      expect(within(getActiveTabPanel()).queryByRole("button", { name: "Cancel" })).toBeNull();
    });
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

  it("renders horizontal section tabs above the binding content", () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("tab", { name: "Agent Harness" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Git Provider" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Connectors" })).toBeDefined();
  });

  it("shows connector empty-state copy with a single add action", () => {
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    activateIntegrationsTab("Connectors");

    const connectorsPanel = getActiveTabPanel();
    expect(
      within(connectorsPanel).getAllByText(
        "Add connectors to give the agent access to external tools and their resources, like Linear or Slack.",
      ).length,
    ).toBe(1);
    const addButtons = within(connectorsPanel).getAllByRole("button", { name: "Add" });
    expect(addButtons).toHaveLength(1);
    expect(addButtons[0]?.hasAttribute("disabled")).toBe(false);
  });
});
