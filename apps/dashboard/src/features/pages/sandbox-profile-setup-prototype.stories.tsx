import { Button, SectionBlock } from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { PageFrame } from "../shared/page-frame.js";
import {
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryLinearConnection,
  StoryOpenAiConnection,
  StorySlackConnection,
} from "./integrations-editor-section-story-support.js";
import { preserveDialogRowIdentity } from "./integrations-editor-section.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  SandboxProfileBindingDialog,
  type SandboxProfileBindingDialogState,
} from "./sandbox-profile-binding-dialog.js";
import { SandboxProfileBindingSection } from "./sandbox-profile-binding-section.js";

const InitialRows: readonly SandboxProfileBindingEditorRow[] = [
  {
    clientId: "row-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent",
    config: {
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "Stay concise and ask before destructive changes.",
        },
      },
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    },
  },
  {
    clientId: "row-github-git",
    connectionId: StoryGithubConnection.id,
    kind: "git",
    config: {
      repositories: [
        "mistle/main-dashboard",
        "mistle/control-plane-api",
        "mistle/session-workbench",
      ],
      tools: ["github-cli"],
    },
  },
  {
    clientId: "row-slack-connector",
    connectionId: StorySlackConnection.id,
    kind: "connector",
    config: {
      tools: ["slack-mcp"],
    },
  },
  {
    clientId: "row-linear-connector",
    connectionId: StoryLinearConnection.id,
    kind: "connector",
    config: {
      tools: ["linear-mcp"],
    },
  },
] as const;

function createDialogDraftRow(
  kind: SandboxProfileBindingEditorRow["kind"],
  connectionId: string,
): SandboxProfileBindingEditorRow {
  return {
    clientId: "dialog-draft",
    connectionId,
    kind,
    config: {},
  };
}

function buildAvailableConnectionsByKind(input: {
  connections: readonly IntegrationConnectionSummary[];
  targets: readonly IntegrationTargetSummary[];
}): Record<SandboxProfileBindingEditorRow["kind"], IntegrationConnectionSummary[]> {
  const connectionsByKind: Record<
    SandboxProfileBindingEditorRow["kind"],
    IntegrationConnectionSummary[]
  > = {
    agent: [],
    git: [],
    connector: [],
  };

  for (const connection of input.connections) {
    const target = input.targets.find((candidate) => candidate.targetKey === connection.targetKey);
    const kind = resolveBindingKindFromTarget(target);
    if (kind === undefined) {
      continue;
    }
    connectionsByKind[kind].push(connection);
  }

  return connectionsByKind;
}

export type SandboxProfileSetupPageViewStoryProps = {
  initialRows?: readonly SandboxProfileBindingEditorRow[];
  availableConnections?: readonly IntegrationConnectionSummary[];
  availableTargets?: readonly IntegrationTargetSummary[];
};

export function SandboxProfileSetupPageViewStory(
  input: SandboxProfileSetupPageViewStoryProps,
): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    seedStoryIntegrationResources({
      queryClient: client,
      resources: StoryGithubResources,
    });
    return client;
  });
  const [profileName, setProfileName] = useState("Customer Support Sandbox");
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>(
    input.initialRows ?? InitialRows,
  );
  const [dialogState, setDialogState] = useState<SandboxProfileBindingDialogState | null>(null);

  const availableConnections = input.availableConnections ?? StoryIntegrationConnections;
  const availableTargets = input.availableTargets ?? StoryIntegrationTargets;
  const availableConnectionsByKind = buildAvailableConnectionsByKind({
    connections: availableConnections,
    targets: availableTargets,
  });

  const rowsByKind = {
    agent: rows.filter((row) => row.kind === "agent"),
    git: rows.filter((row) => row.kind === "git"),
    connector: rows.filter((row) => row.kind === "connector"),
  };

  function openAddDialog(kind: SandboxProfileBindingEditorRow["kind"]): void {
    const initialConnectionId =
      availableConnectionsByKind[kind].length === 1
        ? (availableConnectionsByKind[kind][0]?.id ?? "")
        : "";

    setDialogState({
      mode: "add",
      row: createDialogDraftRow(kind, initialConnectionId),
      error: null,
    });
  }

  function openEditDialog(row: SandboxProfileBindingEditorRow): void {
    setDialogState({
      mode: "edit",
      row: { ...row },
      error: null,
    });
  }

  function closeDialog(): void {
    setDialogState(null);
  }

  function onConnectionIdChange(nextConnectionId: string): void {
    if (dialogState === null) {
      return;
    }

    setDialogState({
      ...dialogState,
      row: preserveDialogRowIdentity({
        currentRow: dialogState.row,
        nextDraftRow: createDialogDraftRow(dialogState.row.kind, nextConnectionId),
      }),
      error: null,
    });
  }

  function onDialogRowChange(
    _clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ): void {
    if (dialogState === null) {
      return;
    }

    setDialogState({
      ...dialogState,
      row: {
        ...dialogState.row,
        ...changes,
      },
      error: null,
    });
  }

  function onRowChange(
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ): void {
    setRows((currentRows) =>
      currentRows.map((row) => (row.clientId === clientId ? { ...row, ...changes } : row)),
    );
  }

  function onRemove(clientId: string): void {
    setRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
  }

  async function onCreateBindingFromConnection(inputValue: {
    kind: SandboxProfileBindingEditorRow["kind"];
    connectionId: string;
  }): Promise<void> {
    const selectedConnection = availableConnectionsByKind[inputValue.kind].find(
      (connection) => connection.id === inputValue.connectionId,
    );
    if (selectedConnection === undefined) {
      return;
    }

    const target = availableTargets.find(
      (candidate) => candidate.targetKey === selectedConnection.targetKey,
    );
    if (target === undefined) {
      return;
    }

    setRows((currentRows) => [
      ...currentRows,
      {
        clientId: `row-${String(currentRows.length + 1)}`,
        connectionId: selectedConnection.id,
        kind: inputValue.kind,
        config: createDefaultBindingConfig({
          connection: selectedConnection,
          target,
        }),
      },
    ]);
  }

  function onDialogSave(): void {
    if (dialogState === null) {
      return;
    }

    if (dialogState.row.connectionId.trim().length === 0) {
      setDialogState({
        ...dialogState,
        error: "Select a connection to add this binding.",
      });
      return;
    }

    if (dialogState.mode === "edit") {
      onRowChange(dialogState.row.clientId, {
        connectionId: dialogState.row.connectionId,
        kind: dialogState.row.kind,
        config: dialogState.row.config,
      });
      closeDialog();
      return;
    }

    setRows((currentRows) => [
      ...currentRows,
      {
        clientId: `row-${String(currentRows.length + 1)}`,
        connectionId: dialogState.row.connectionId,
        kind: dialogState.row.kind,
        config: dialogState.row.config,
      },
    ]);
    closeDialog();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <PageFrame maxWidthClassName="max-w-5xl" title="">
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <AutoSaveTitleHeading
              ariaLabel="Profile name"
              emptyDisplayText="Untitled profile"
              onSave={async (nextValue) => {
                setProfileName(nextValue);
              }}
              requiredLabel="Profile name"
              value={profileName}
            />
          </div>
          <div className="flex flex-col gap-8">
            <SandboxProfileBindingSection
              addDisabled={
                rowsByKind.agent.length > 0 || availableConnectionsByKind.agent.length === 0
              }
              availableConnections={availableConnections}
              availableTargets={availableTargets}
              kind="agent"
              onAdd={() => {
                openAddDialog("agent");
              }}
              onCreateBindingFromConnection={onCreateBindingFromConnection}
              onEdit={openEditDialog}
              onRemove={onRemove}
              onRowChange={onRowChange}
              rowErrorsByClientId={{}}
              rows={rowsByKind.agent}
            />

            <SandboxProfileBindingSection
              addDisabled={rowsByKind.git.length > 0 || availableConnectionsByKind.git.length === 0}
              availableConnections={availableConnections}
              availableTargets={availableTargets}
              kind="git"
              onAdd={() => {
                openAddDialog("git");
              }}
              onCreateBindingFromConnection={onCreateBindingFromConnection}
              onEdit={openEditDialog}
              onRemove={onRemove}
              onRowChange={onRowChange}
              rowErrorsByClientId={{}}
              rows={rowsByKind.git}
            />

            <SectionBlock
              action={
                <Button
                  onClick={() => {
                    openAddDialog("connector");
                  }}
                  type="button"
                  variant="outline"
                >
                  <PlusIcon />
                  Add
                </Button>
              }
              {...(rowsByKind.connector.length === 0
                ? {
                    emptyState:
                      "Add connectors to give the agent access to external tools and their resources, like Linear or Slack.",
                  }
                : {
                    children: (
                      <SandboxProfileBindingSection
                        addDisabled={availableConnectionsByKind.connector.length === 0}
                        availableConnections={availableConnections}
                        availableTargets={availableTargets}
                        kind="connector"
                        onAdd={() => {
                          openAddDialog("connector");
                        }}
                        onEdit={openEditDialog}
                        onRemove={onRemove}
                        onRowChange={onRowChange}
                        rowErrorsByClientId={{}}
                        rows={rowsByKind.connector}
                        showSectionChrome={false}
                      />
                    ),
                  })}
              title="Connectors"
            />
          </div>

          <SandboxProfileBindingDialog
            availableConnections={availableConnections}
            availableConnectionsByKind={availableConnectionsByKind}
            availableTargets={availableTargets}
            isSubmittingIntegrationBindings={false}
            onClose={closeDialog}
            onConnectionIdChange={onConnectionIdChange}
            onRowChange={onDialogRowChange}
            onSave={onDialogSave}
            state={dialogState}
          />
        </div>
      </PageFrame>
    </QueryClientProvider>
  );
}

/**
 * Storybook page variant for reviewing a single-page sandbox profile setup flow
 * using the existing dashboard editor components.
 */
const meta = {
  title: "Dashboard/SandboxProfiles/SetupFlow/PageView",
  component: SandboxProfileSetupPageViewStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof SandboxProfileSetupPageViewStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
