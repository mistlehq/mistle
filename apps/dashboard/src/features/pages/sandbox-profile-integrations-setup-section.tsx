import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type React from "react";
import { useState } from "react";
import { Link } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { ActionTile } from "../shared/action-tile.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { resolveRowBindingMetadata } from "./sandbox-profile-binding-shared.js";

type IntegrationChoice = {
  id: string;
  kind: SandboxIntegrationBindingKind;
  hasSelectableConnections: boolean;
  logoKey: string | undefined;
  title: React.ReactNode;
};

const NoIntegrationValue = "none";

function IntegrationNameCell(input: { item: IntegrationChoice }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm">
      {input.item.logoKey === undefined ? null : (
        <img
          alt=""
          className="h-5 w-5 rounded-sm"
          src={resolveIntegrationLogoPath({ logoKey: input.item.logoKey })}
        />
      )}
      <div className="min-w-0 truncate font-medium">{input.item.title}</div>
    </div>
  );
}

function IntegrationSelectionCell(input: {
  ariaLabel: string;
  choices: readonly IntegrationChoice[];
  selectedIntegrationId: string;
  onIntegrationChange: (nextIntegrationId: string) => void;
  allowNone?: boolean;
}): React.JSX.Element {
  const selectedIntegration = input.choices.find(
    (choice) => choice.id === input.selectedIntegrationId,
  );

  return (
    <Select
      onValueChange={(nextIntegrationId) => {
        if (nextIntegrationId === null) {
          return;
        }
        input.onIntegrationChange(nextIntegrationId);
      }}
      value={input.selectedIntegrationId}
    >
      <SelectTrigger aria-label={input.ariaLabel} className="w-full min-w-0">
        <SelectValue placeholder="Choose an integration">
          {selectedIntegration === undefined ? (
            "None"
          ) : (
            <IntegrationNameCell item={selectedIntegration} />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {input.allowNone === true ? <SelectItem value={NoIntegrationValue}>None</SelectItem> : null}
        {input.choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            <div className="flex items-center gap-2">
              {choice.logoKey === undefined ? null : (
                <img
                  alt=""
                  className="h-5 w-5 rounded-sm"
                  src={resolveIntegrationLogoPath({ logoKey: choice.logoKey })}
                />
              )}
              <span>{choice.title}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ConnectionSelectionCell(input: {
  ariaLabel: string;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  selectedConnectionId: string | undefined;
  onConnectionChange: (nextConnectionId: string) => void;
}): React.JSX.Element {
  const selectedConnection = input.availableConnections.find(
    (connection) => connection.id === input.selectedConnectionId,
  );
  const selectedTarget =
    selectedConnection === undefined
      ? undefined
      : input.availableTargets.find((target) => target.targetKey === selectedConnection.targetKey);

  if (input.availableConnections.length === 0) {
    return <p className="text-muted-foreground text-sm">No connections available.</p>;
  }

  return (
    <Select
      onValueChange={(nextConnectionId) => {
        if (nextConnectionId === null) {
          return;
        }
        input.onConnectionChange(nextConnectionId);
      }}
      value={input.selectedConnectionId ?? null}
    >
      <SelectTrigger aria-label={input.ariaLabel} className="w-full min-w-0">
        <SelectValue placeholder="Choose a connection">
          {selectedConnection === undefined ? (
            "Choose a connection"
          ) : (
            <div className="flex items-center gap-2 text-sm">
              {selectedTarget?.logoKey === undefined ? null : (
                <img
                  alt=""
                  className="h-5 w-5 rounded-sm"
                  src={resolveIntegrationLogoPath({ logoKey: selectedTarget.logoKey })}
                />
              )}
              <span className="truncate">{selectedConnection.displayName}</span>
            </div>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {input.availableConnections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connection.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function resolveKindChoices(input: {
  kind: SandboxIntegrationBindingKind;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  includeDisconnectedTargets?: boolean;
}): IntegrationChoice[] {
  const choices: IntegrationChoice[] = [];
  const seenTargetKeys = new Set<string>();

  for (const target of input.availableTargets) {
    if (
      resolveBindingKindFromTarget(target) !== input.kind ||
      seenTargetKeys.has(target.targetKey)
    ) {
      continue;
    }

    const hasSelectableConnections = input.availableConnections.some(
      (connection) => connection.targetKey === target.targetKey,
    );
    if (!hasSelectableConnections && input.includeDisconnectedTargets !== true) {
      continue;
    }

    seenTargetKeys.add(target.targetKey);
    choices.push({
      id: target.targetKey,
      hasSelectableConnections,
      kind: input.kind,
      logoKey: target.logoKey,
      title: target.displayName,
    });
  }

  return choices;
}

function resolveConnectionsForTarget(input: {
  targetKey: string | null;
  availableConnections: readonly IntegrationConnectionSummary[];
}): IntegrationConnectionSummary[] {
  if (input.targetKey === null) {
    return [];
  }

  return input.availableConnections.filter(
    (connection) => connection.targetKey === input.targetKey,
  );
}

function findTargetForConnection(input: {
  connectionId: string | undefined;
  availableConnections: readonly IntegrationConnectionSummary[];
}): string | null {
  if (input.connectionId === undefined) {
    return null;
  }

  return (
    input.availableConnections.find((connection) => connection.id === input.connectionId)
      ?.targetKey ?? null
  );
}

function buildDefaultConfig(input: {
  connectionId: string;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): Record<string, unknown> | null {
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.connectionId,
  );
  if (connection === undefined) {
    return null;
  }
  const target = input.availableTargets.find(
    (candidate) => candidate.targetKey === connection.targetKey,
  );
  if (target === undefined) {
    return null;
  }

  return createDefaultBindingConfig({
    connection,
    target,
  });
}

function AddConnectorTile(input: {
  choice: IntegrationChoice;
  onAdd: (targetKey: string) => void;
}): React.JSX.Element {
  return (
    <ActionTile
      action={
        input.choice.hasSelectableConnections ? (
          <Button
            onClick={() => {
              input.onAdd(input.choice.id);
            }}
            type="button"
          >
            Add
          </Button>
        ) : (
          <Link
            className="text-primary inline-flex items-center px-0 text-sm font-medium underline-offset-4 hover:underline"
            rel="noreferrer"
            target="_blank"
            to={`/integrations/${input.choice.id}`}
          >
            Setup integration
          </Link>
        )
      }
      description=""
      leading={
        input.choice.logoKey === undefined ? null : (
          <img alt="" src={resolveIntegrationLogoPath({ logoKey: input.choice.logoKey })} />
        )
      }
      title={input.choice.title}
    />
  );
}

function UnresolvedConnectionCell(input: { message: string }): React.JSX.Element {
  return <p className="text-destructive text-sm">{input.message}</p>;
}

function UnresolvedIntegrationCell(input: { title: string }): React.JSX.Element {
  return <p className="text-destructive truncate text-sm">{input.title}</p>;
}

function UnresolvedNoneCell(): React.JSX.Element {
  return <p className="text-sm">None</p>;
}

function resolveConnectorRowIssue(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): "missing-connection" | "missing-target" | null {
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.row.connectionId,
  );
  if (connection === undefined) {
    return "missing-connection";
  }

  const target = input.availableTargets.find(
    (candidate) => candidate.targetKey === connection.targetKey,
  );
  return target === undefined ? "missing-target" : null;
}

function resolveBindingIssue(input: {
  row: SandboxProfileBindingEditorRow | null;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): "missing-connection" | "missing-target" | null {
  const row = input.row;
  if (row === null) {
    return null;
  }

  const connection = input.availableConnections.find(
    (candidate) => candidate.id === row.connectionId,
  );
  if (connection === undefined) {
    return "missing-connection";
  }

  const target = input.availableTargets.find(
    (candidate) => candidate.targetKey === connection.targetKey,
  );
  return target === undefined ? "missing-target" : null;
}

export function SandboxProfileIntegrationsSetupSection(input: {
  integrationBindingsQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  integrationDirectoryQuery: {
    isError: boolean;
    error: unknown;
    isPending: boolean;
  };
  integrationSaveError: string | null;
  integrationRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onAddIntegrationBindingRow: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onRemoveIntegrationBindingRow: (clientId: string) => void;
}): React.JSX.Element {
  const [isAddConnectorsDialogOpen, setIsAddConnectorsDialogOpen] = useState(false);
  const agentChoices = resolveKindChoices({
    kind: "agent",
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const gitChoices = resolveKindChoices({
    kind: "git",
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const connectorChoices = resolveKindChoices({
    kind: "connector",
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
    includeDisconnectedTargets: true,
  });

  const agentRow = input.integrationRows.find((row) => row.kind === "agent") ?? null;
  const gitRow = input.integrationRows.find((row) => row.kind === "git") ?? null;
  const connectorRows = input.integrationRows.filter((row) => row.kind === "connector");
  const selectedConnectorTargetKeys = new Set(
    connectorRows
      .map(
        (row) =>
          resolveRowBindingMetadata({
            row,
            availableConnections: input.availableConnections,
            availableTargets: input.availableTargets,
          })?.target?.targetKey,
      )
      .filter((targetKey): targetKey is string => typeof targetKey === "string"),
  );
  const addConnectorChoices = connectorChoices.filter(
    (choice) => !selectedConnectorTargetKeys.has(choice.id),
  );
  const agentIssue = resolveBindingIssue({
    row: agentRow,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const gitIssue = resolveBindingIssue({
    row: gitRow,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const hasUnresolvedConnectorRows = connectorRows.some(
    (row) =>
      resolveConnectorRowIssue({
        row,
        availableConnections: input.availableConnections,
        availableTargets: input.availableTargets,
      }) !== null,
  );
  const hasUnresolvedRows = agentIssue !== null || gitIssue !== null || hasUnresolvedConnectorRows;

  const agentDisplayChoice =
    agentChoices[0] === undefined
      ? undefined
      : {
          ...agentChoices[0],
          title: (
            <span className="flex items-center gap-2">
              <span>Codex</span>
              <Badge variant="outline">Default</Badge>
            </span>
          ),
        };

  async function upsertSingleBinding(inputValue: {
    kind: Extract<SandboxIntegrationBindingKind, "agent" | "git">;
    targetKey: string;
    row: SandboxProfileBindingEditorRow | null;
  }): Promise<void> {
    const connections = resolveConnectionsForTarget({
      targetKey: inputValue.targetKey,
      availableConnections: input.availableConnections,
    });
    const nextConnection = connections[0];
    if (nextConnection === undefined) {
      return;
    }
    const nextConfig = buildDefaultConfig({
      connectionId: nextConnection.id,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
    });
    if (nextConfig === null) {
      return;
    }

    if (inputValue.row === null) {
      await input.onAddIntegrationBindingRow({
        kind: inputValue.kind,
        connectionId: nextConnection.id,
        config: nextConfig,
      });
      return;
    }

    input.onIntegrationBindingRowChange(inputValue.row.clientId, {
      connectionId: nextConnection.id,
      config: nextConfig,
    });
  }

  function updateBindingConnection(
    row: SandboxProfileBindingEditorRow,
    nextConnectionId: string,
  ): void {
    const nextConfig = buildDefaultConfig({
      connectionId: nextConnectionId,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
    });
    if (nextConfig === null) {
      return;
    }

    input.onIntegrationBindingRowChange(row.clientId, {
      connectionId: nextConnectionId,
      config: nextConfig,
    });
  }

  async function addConnector(targetKey: string): Promise<void> {
    const connections = resolveConnectionsForTarget({
      targetKey,
      availableConnections: input.availableConnections,
    });
    const nextConnection = connections[0];
    if (nextConnection === undefined) {
      return;
    }
    const nextConfig = buildDefaultConfig({
      connectionId: nextConnection.id,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
    });
    if (nextConfig === null) {
      return;
    }

    const didSave = await input.onAddIntegrationBindingRow({
      kind: "connector",
      connectionId: nextConnection.id,
      config: nextConfig,
    });

    if (didSave && addConnectorChoices.length === 1) {
      setIsAddConnectorsDialogOpen(false);
    }
  }

  const agentTargetKey = findTargetForConnection({
    connectionId: agentRow?.connectionId,
    availableConnections: input.availableConnections,
  });
  const gitTargetKey = findTargetForConnection({
    connectionId: gitRow?.connectionId,
    availableConnections: input.availableConnections,
  });

  return (
    <div className="flex flex-col gap-4">
      {input.integrationBindingsQuery.isError ? (
        <Notice title="Could not load integration bindings" variant="alert">
          {resolveApiErrorMessage({
            error: input.integrationBindingsQuery.error,
            fallbackMessage: "Could not load sandbox profile integration bindings.",
          })}
        </Notice>
      ) : null}

      {input.integrationDirectoryQuery.isError ? (
        <Notice title="Could not load integration connections" variant="alert">
          {resolveApiErrorMessage({
            error: input.integrationDirectoryQuery.error,
            fallbackMessage: "Could not load integration connections.",
          })}
        </Notice>
      ) : null}

      {input.integrationSaveError ? (
        <Notice title="Save failed" variant="alert">
          {input.integrationSaveError}
        </Notice>
      ) : null}

      {hasUnresolvedRows ? (
        <Notice title="Some integrations need attention" variant="alert">
          Remove or replace integrations where the connection cannot be found.
        </Notice>
      ) : null}

      <div className="max-w-5xl">
        <div className="flex flex-col">
          <div className="text-muted-foreground grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_2rem] gap-6 border-b py-2 text-xs uppercase tracking-wide">
            <div className="min-w-0">
              <p>Type</p>
            </div>
            <div className="min-w-0">
              <p>Integration</p>
            </div>
            <div className="min-w-0">
              <p>Connection</p>
            </div>
            <div className="w-8 shrink-0" />
          </div>

          <div className="grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-6 border-b py-4">
            <div className="min-w-0">
              <p className="text-primary text-sm font-medium">Agent Harness</p>
            </div>
            <div className="min-w-0">
              {agentDisplayChoice === undefined ? null : (
                <IntegrationNameCell item={agentDisplayChoice} />
              )}
            </div>
            <div className="min-w-0">
              <ConnectionSelectionCell
                ariaLabel="agent harness connection"
                availableConnections={resolveConnectionsForTarget({
                  targetKey: agentTargetKey ?? agentChoices[0]?.id ?? null,
                  availableConnections: input.availableConnections,
                })}
                availableTargets={input.availableTargets}
                onConnectionChange={(nextConnectionId) => {
                  if (agentRow === null) {
                    const nextConfig = buildDefaultConfig({
                      connectionId: nextConnectionId,
                      availableConnections: input.availableConnections,
                      availableTargets: input.availableTargets,
                    });
                    if (nextConfig === null) {
                      return;
                    }
                    void input.onAddIntegrationBindingRow({
                      kind: "agent",
                      connectionId: nextConnectionId,
                      config: nextConfig,
                    });
                    return;
                  }
                  updateBindingConnection(agentRow, nextConnectionId);
                }}
                selectedConnectionId={agentRow?.connectionId}
              />
            </div>
            <div className="w-8 shrink-0" />
          </div>

          <div className="grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-6 border-b py-4">
            <div className="min-w-0">
              <p className="text-primary text-sm font-medium">Git Provider</p>
            </div>
            <div className="min-w-0">
              {gitIssue === null ? (
                <IntegrationSelectionCell
                  allowNone={true}
                  ariaLabel="git provider integration"
                  choices={gitChoices}
                  onIntegrationChange={(nextTargetKey) => {
                    if (nextTargetKey === NoIntegrationValue) {
                      if (gitRow !== null) {
                        input.onRemoveIntegrationBindingRow(gitRow.clientId);
                      }
                      return;
                    }
                    void upsertSingleBinding({
                      kind: "git",
                      row: gitRow,
                      targetKey: nextTargetKey,
                    });
                  }}
                  selectedIntegrationId={gitTargetKey ?? NoIntegrationValue}
                />
              ) : (
                <UnresolvedNoneCell />
              )}
            </div>
            <div className="min-w-0">
              {gitIssue === "missing-connection" ? (
                <UnresolvedConnectionCell message="Connection cannot be found" />
              ) : gitIssue === "missing-target" ? (
                <UnresolvedConnectionCell message="Integration no longer available." />
              ) : gitTargetKey === null ? null : (
                <ConnectionSelectionCell
                  ariaLabel="git provider connection"
                  availableConnections={resolveConnectionsForTarget({
                    targetKey: gitTargetKey,
                    availableConnections: input.availableConnections,
                  })}
                  availableTargets={input.availableTargets}
                  onConnectionChange={(nextConnectionId) => {
                    if (gitRow === null) {
                      const nextConfig = buildDefaultConfig({
                        connectionId: nextConnectionId,
                        availableConnections: input.availableConnections,
                        availableTargets: input.availableTargets,
                      });
                      if (nextConfig === null) {
                        return;
                      }
                      void input.onAddIntegrationBindingRow({
                        kind: "git",
                        connectionId: nextConnectionId,
                        config: nextConfig,
                      });
                      return;
                    }
                    updateBindingConnection(gitRow, nextConnectionId);
                  }}
                  selectedConnectionId={gitRow?.connectionId}
                />
              )}
            </div>
            <div className="flex w-8 shrink-0 justify-end">
              {gitIssue === null || gitRow === null ? null : (
                <Button
                  aria-label="Remove git provider"
                  className="h-7 w-7"
                  onClick={() => {
                    input.onRemoveIntegrationBindingRow(gitRow.clientId);
                  }}
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon aria-hidden className="size-4" />
                </Button>
              )}
            </div>
          </div>

          {connectorRows.map((row) => {
            const rowMetadata = resolveRowBindingMetadata({
              row,
              availableConnections: input.availableConnections,
              availableTargets: input.availableTargets,
            });
            const target = rowMetadata?.target;
            const connection = input.availableConnections.find(
              (candidate) => candidate.id === row.connectionId,
            );
            const connectionTarget =
              connection === undefined
                ? undefined
                : input.availableTargets.find(
                    (candidate) => candidate.targetKey === connection.targetKey,
                  );
            const integrationTitle =
              connection === undefined
                ? "Unknown integration"
                : (target?.displayName ?? connectionTarget?.displayName ?? "Unknown integration");
            const integrationLogoKey = target?.logoKey ?? connectionTarget?.logoKey;
            const connectionMessage =
              connection === undefined
                ? "Connection cannot be found"
                : target === undefined
                  ? "Integration no longer available."
                  : null;

            return (
              <div
                className="grid grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-6 border-b py-4"
                key={row.clientId}
              >
                <div className="min-w-0">
                  <p className="text-primary text-sm font-medium">Connector</p>
                </div>
                <div className="min-w-0">
                  {connection === undefined ? (
                    <UnresolvedIntegrationCell title={integrationTitle} />
                  ) : (
                    <IntegrationNameCell
                      item={{
                        id: target?.targetKey ?? connectionTarget?.targetKey ?? row.clientId,
                        hasSelectableConnections: true,
                        kind: "connector",
                        logoKey: integrationLogoKey,
                        title: integrationTitle,
                      }}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  {connectionMessage === null && target !== undefined ? (
                    <ConnectionSelectionCell
                      ariaLabel={`${target.displayName} connection`}
                      availableConnections={resolveConnectionsForTarget({
                        targetKey: target.targetKey,
                        availableConnections: input.availableConnections,
                      })}
                      availableTargets={input.availableTargets}
                      onConnectionChange={(nextConnectionId) => {
                        updateBindingConnection(row, nextConnectionId);
                      }}
                      selectedConnectionId={row.connectionId}
                    />
                  ) : (
                    <UnresolvedConnectionCell
                      message={connectionMessage ?? "Connection cannot be found"}
                    />
                  )}
                </div>
                <div className="flex w-8 shrink-0 justify-end">
                  <Button
                    aria-label="Remove connector"
                    className="h-7 w-7"
                    onClick={() => {
                      input.onRemoveIntegrationBindingRow(row.clientId);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <TrashIcon aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {addConnectorChoices.length === 0 ? null : (
        <div className="max-w-5xl">
          <Button
            className="px-0 text-sm"
            onClick={() => {
              setIsAddConnectorsDialogOpen(true);
            }}
            type="button"
            variant="link"
          >
            <PlusIcon aria-hidden className="size-4" />
            Add more connectors
          </Button>
        </div>
      )}

      <Dialog
        onOpenChange={(nextOpen) => {
          setIsAddConnectorsDialogOpen(nextOpen);
        }}
        open={isAddConnectorsDialogOpen}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader variant="sectioned">
            <DialogTitle>Add connectors</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {addConnectorChoices.map((choice) => (
              <AddConnectorTile
                choice={choice}
                key={choice.id}
                onAdd={(targetKey) => {
                  void addConnector(targetKey);
                }}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
