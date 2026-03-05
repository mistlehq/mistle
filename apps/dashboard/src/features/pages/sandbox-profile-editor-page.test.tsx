// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { IntegrationsEditorSection } from "./sandbox-profile-editor-page.js";

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
  return {
    targetKey,
    displayName: targetKey,
    familyId: "test-family",
    variantId: "test-variant",
    targetHealth: {
      configStatus: "valid",
    },
    resolvedBindingEditorUi: {
      bindingEditor: {
        kind,
        config: {
          mode: "static",
          variant: {
            fields: [],
          },
        },
      },
    },
  };
}

function Harness(): React.JSX.Element {
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>([]);
  const [nextId, setNextId] = useState(1);

  const connections: readonly IntegrationConnectionSummary[] = [
    {
      id: "conn-agent",
      targetKey: "target-agent",
      status: "active",
    },
    {
      id: "conn-git",
      targetKey: "target-git",
      status: "active",
    },
  ];
  const targets: readonly IntegrationTargetSummary[] = [
    createTarget("target-agent", "agent"),
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

    expect(screen.getByRole("heading", { name: "Add Agent binding" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add binding" }));

    expect(await screen.findByText("Agent Binding 1")).toBeDefined();
  });
});
