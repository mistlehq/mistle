import {
  Button,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
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
import {
  formatBindingSectionConstraint,
  SandboxProfileBindingSection,
  shouldHideBindingSectionAddAction,
} from "./sandbox-profile-binding-section.js";

export type IntegrationsEditorSectionProps = {
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
  integrationRowErrorsByClientId: Readonly<Record<string, string>>;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onRemoveIntegrationBindingRow: (clientId: string) => void;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onAddIntegrationBindingRow: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  isSubmittingIntegrationBindings: boolean;
  onHasUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void;
};

const BindingSectionKinds: readonly SandboxIntegrationBindingKind[] = ["agent", "git", "connector"];
const BindingSectionTabs = [
  {
    kind: "agent",
    label: "Agent Harness",
  },
  {
    kind: "git",
    label: "Git Provider",
  },
  {
    kind: "connector",
    label: "Connectors",
  },
] as const satisfies readonly {
  kind: SandboxIntegrationBindingKind;
  label: string;
}[];

export function preserveDialogRowIdentity(input: {
  currentRow: SandboxProfileBindingEditorRow;
  nextDraftRow: SandboxProfileBindingEditorRow;
}): SandboxProfileBindingEditorRow {
  return {
    ...input.nextDraftRow,
    clientId: input.currentRow.clientId,
    ...(input.currentRow.id === undefined ? {} : { id: input.currentRow.id }),
  };
}

export function IntegrationsEditorSection(
  props: IntegrationsEditorSectionProps,
): React.JSX.Element {
  const [integrationDialogState, setIntegrationDialogState] =
    useState<SandboxProfileBindingDialogState | null>(null);
  const [activeTab, setActiveTab] = useState<SandboxIntegrationBindingKind>("agent");
  const [dirtyDraftRowsByClientId, setDirtyDraftRowsByClientId] = useState<
    Readonly<Record<string, true>>
  >({});

  const availableConnectionsByKind: Record<
    SandboxIntegrationBindingKind,
    IntegrationConnectionSummary[]
  > = {
    agent: [],
    git: [],
    connector: [],
  };

  for (const connection of props.availableConnections) {
    const target = props.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    const kind = resolveBindingKindFromTarget(target);
    if (kind === undefined) {
      continue;
    }
    availableConnectionsByKind[kind].push(connection);
  }

  const integrationRowsByKind: Record<
    SandboxIntegrationBindingKind,
    SandboxProfileBindingEditorRow[]
  > = {
    agent: [],
    git: [],
    connector: [],
  };

  for (const row of props.integrationRows) {
    integrationRowsByKind[row.kind].push(row);
  }

  useEffect(() => {
    const activeClientIds = new Set(props.integrationRows.map((row) => row.clientId));
    setDirtyDraftRowsByClientId((currentRows) => {
      let hasChanges = false;
      const nextRows: Record<string, true> = {};

      for (const clientId of Object.keys(currentRows)) {
        if (!activeClientIds.has(clientId)) {
          hasChanges = true;
          continue;
        }
        nextRows[clientId] = true;
      }

      return hasChanges ? nextRows : currentRows;
    });
  }, [props.integrationRows]);

  const hasUnsavedChanges = Object.keys(dirtyDraftRowsByClientId).length > 0;

  useEffect(() => {
    props.onHasUnsavedChangesChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, props.onHasUnsavedChangesChange]);

  function closeIntegrationDialog(): void {
    setIntegrationDialogState(null);
  }

  function createDraftRow(
    kind: SandboxIntegrationBindingKind,
    connectionId: string,
  ): SandboxProfileBindingEditorRow {
    return {
      clientId: "dialog-draft",
      connectionId,
      kind,
      config: {},
    };
  }

  function openAddDialog(kind: SandboxIntegrationBindingKind): void {
    const initialConnectionId =
      availableConnectionsByKind[kind].length === 1
        ? (availableConnectionsByKind[kind][0]?.id ?? "")
        : "";
    setIntegrationDialogState({
      mode: "add",
      row: createDraftRow(kind, initialConnectionId),
      error: null,
    });
  }

  function openEditDialog(row: SandboxProfileBindingEditorRow): void {
    setIntegrationDialogState({
      mode: "edit",
      row: {
        ...row,
      },
      error: null,
    });
  }

  function updateDialogConnectionId(nextConnectionId: string): void {
    if (integrationDialogState === null) {
      return;
    }
    const nextDraftRow = createDraftRow(integrationDialogState.row.kind, nextConnectionId);
    setIntegrationDialogState({
      ...integrationDialogState,
      row: preserveDialogRowIdentity({
        currentRow: integrationDialogState.row,
        nextDraftRow,
      }),
      error: null,
    });
  }

  function updateDialogRow(
    _clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ): void {
    if (integrationDialogState === null) {
      return;
    }
    setIntegrationDialogState({
      ...integrationDialogState,
      row: {
        ...integrationDialogState.row,
        ...changes,
      },
      error: null,
    });
  }

  function saveBindingFromDialog(): void {
    if (integrationDialogState === null) {
      return;
    }

    if (integrationDialogState.row.connectionId.trim().length === 0) {
      setIntegrationDialogState({
        ...integrationDialogState,
        error: "Select a connection to add this binding.",
      });
      return;
    }

    const selectedConnection = availableConnectionsByKind[integrationDialogState.row.kind].find(
      (connection) => connection.id === integrationDialogState.row.connectionId,
    );
    if (selectedConnection === undefined) {
      setIntegrationDialogState({
        ...integrationDialogState,
        error: "Selected connection is no longer available.",
      });
      return;
    }

    if (integrationDialogState.mode === "edit") {
      props.onIntegrationBindingRowChange(integrationDialogState.row.clientId, {
        connectionId: integrationDialogState.row.connectionId,
        kind: integrationDialogState.row.kind,
        config: integrationDialogState.row.config,
      });
      closeIntegrationDialog();
      return;
    }

    void props
      .onAddIntegrationBindingRow({
        kind: integrationDialogState.row.kind,
        connectionId: selectedConnection.id,
        config: integrationDialogState.row.config,
      })
      .then((didSave) => {
        if (didSave) {
          closeIntegrationDialog();
          return;
        }
        setIntegrationDialogState((currentState) => {
          if (currentState === null) {
            return currentState;
          }
          return {
            ...currentState,
            error: "Could not add binding.",
          };
        });
      });
  }

  const handleRowDraftDirtyChange = useCallback((clientId: string, isDirty: boolean): void => {
    setDirtyDraftRowsByClientId((currentRows) => {
      const isCurrentlyDirty = currentRows[clientId] === true;
      if (isDirty === isCurrentlyDirty) {
        return currentRows;
      }

      if (isDirty) {
        return {
          ...currentRows,
          [clientId]: true,
        };
      }

      const nextRows: Record<string, true> = {};
      for (const currentClientId of Object.keys(currentRows)) {
        if (currentClientId !== clientId) {
          nextRows[currentClientId] = true;
        }
      }
      return nextRows;
    });
  }, []);

  function isAddDisabled(kind: SandboxIntegrationBindingKind): boolean {
    return (
      props.integrationDirectoryQuery.isPending ||
      availableConnectionsByKind[kind].length === 0 ||
      (kind === "agent" && integrationRowsByKind.agent.length > 0)
    );
  }

  async function createBindingFromConnection(input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
  }): Promise<void> {
    const selectedConnection = availableConnectionsByKind[input.kind].find(
      (connection) => connection.id === input.connectionId,
    );
    if (selectedConnection === undefined) {
      return;
    }

    const target = props.availableTargets.find(
      (candidate) => candidate.targetKey === selectedConnection.targetKey,
    );
    if (target === undefined) {
      return;
    }

    await props.onAddIntegrationBindingRow({
      kind: input.kind,
      connectionId: selectedConnection.id,
      config: createDefaultBindingConfig({
        target,
        connection: selectedConnection,
      }),
    });
  }

  const activeRowCount = integrationRowsByKind[activeTab].length;
  const hideActiveAddAction = shouldHideBindingSectionAddAction({
    kind: activeTab,
    rowCount: activeRowCount,
  });
  const activeAddConstraintMessage =
    activeRowCount > 0 && isAddDisabled(activeTab)
      ? formatBindingSectionConstraint(activeTab)
      : null;
  const activeAddButton = (
    <Button
      disabled={isAddDisabled(activeTab)}
      onClick={() => openAddDialog(activeTab)}
      type="button"
      variant="outline"
    >
      <PlusIcon />
      Add
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="md:hidden">
        <Select
          onValueChange={(value) => setActiveTab(value as SandboxIntegrationBindingKind)}
          value={activeTab}
        >
          <SelectTrigger aria-label="Select integration section" className="w-full">
            <SelectValue placeholder="Select section">
              {BindingSectionTabs.find((tab) => tab.kind === activeTab)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {BindingSectionTabs.map((tab) => (
              <SelectItem key={tab.kind} value={tab.kind}>
                {tab.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-6 md:grid md:grid-cols-[10rem_1px_minmax(0,1fr)] md:gap-0 lg:grid-cols-[11rem_1px_minmax(0,1fr)]">
        <div aria-label="Integration sections" className="hidden flex-col md:flex" role="tablist">
          {BindingSectionTabs.map((tab) => (
            <button
              aria-controls={`sandbox-profile-integrations-panel-${tab.kind}`}
              aria-selected={tab.kind === activeTab}
              className={`flex w-full items-start border-l-2 py-3 pl-4 pr-3 text-left text-sm font-medium leading-tight transition-colors ${
                tab.kind === activeTab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              id={`sandbox-profile-integrations-tab-${tab.kind}`}
              key={tab.kind}
              onClick={() => setActiveTab(tab.kind)}
              role="tab"
              tabIndex={tab.kind === activeTab ? 0 : -1}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div aria-hidden className="hidden self-stretch bg-border md:block md:w-px" />

        <div className="flex min-w-0 flex-1 flex-col gap-4 md:pl-8">
          {props.integrationBindingsQuery.isError ? (
            <Notice title="Could not load integration bindings" variant="alert">
              {resolveApiErrorMessage({
                error: props.integrationBindingsQuery.error,
                fallbackMessage: "Could not load sandbox profile integration bindings.",
              })}
            </Notice>
          ) : null}

          {props.integrationDirectoryQuery.isError ? (
            <Notice title="Could not load integration connections" variant="alert">
              {resolveApiErrorMessage({
                error: props.integrationDirectoryQuery.error,
                fallbackMessage: "Could not load integration connections.",
              })}
            </Notice>
          ) : null}

          {props.integrationSaveError ? (
            <Notice title="Save failed" variant="alert">
              {props.integrationSaveError}
            </Notice>
          ) : null}

          {BindingSectionKinds.map((kind) => (
            <div
              aria-labelledby={`sandbox-profile-integrations-tab-${kind}`}
              className="w-full"
              hidden={activeTab !== kind}
              id={`sandbox-profile-integrations-panel-${kind}`}
              key={kind}
              role="tabpanel"
            >
              {activeTab !== kind || hideActiveAddAction ? null : activeAddConstraintMessage ===
                null ? (
                <div className="mb-4 flex justify-end">{activeAddButton}</div>
              ) : (
                <div className="mb-4 flex justify-end">
                  <Tooltip delay={0}>
                    <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
                      {activeAddButton}
                    </TooltipTrigger>
                    <TooltipContent side="top">{activeAddConstraintMessage}</TooltipContent>
                  </Tooltip>
                </div>
              )}
              <SandboxProfileBindingSection
                addDisabled={isAddDisabled(kind)}
                availableConnections={props.availableConnections}
                availableTargets={props.availableTargets}
                kind={kind}
                onAdd={() => {
                  openAddDialog(kind);
                }}
                onEdit={openEditDialog}
                onRowChange={props.onIntegrationBindingRowChange}
                onRemove={props.onRemoveIntegrationBindingRow}
                rowErrorsByClientId={props.integrationRowErrorsByClientId}
                rows={integrationRowsByKind[kind]}
                showSectionChrome={false}
                onCreateBindingFromConnection={createBindingFromConnection}
                onRowDraftDirtyChange={handleRowDraftDirtyChange}
              />
            </div>
          ))}
        </div>
      </div>

      <SandboxProfileBindingDialog
        availableConnections={props.availableConnections}
        availableConnectionsByKind={availableConnectionsByKind}
        availableTargets={props.availableTargets}
        isSubmittingIntegrationBindings={props.isSubmittingIntegrationBindings}
        onClose={closeIntegrationDialog}
        onConnectionIdChange={updateDialogConnectionId}
        onRowChange={updateDialogRow}
        onSave={saveBindingFromDialog}
        state={integrationDialogState}
      />
    </div>
  );
}
