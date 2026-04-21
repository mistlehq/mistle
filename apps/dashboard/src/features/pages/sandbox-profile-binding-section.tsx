import {
  Button,
  Checkbox,
  DetailLabel,
  Notice,
  SectionBlock,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import * as React from "react";

import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { ActionTile } from "../shared/action-tile.js";
import { SandboxProfileBindingCard } from "./sandbox-profile-binding-card.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  createDefaultBindingConfig,
  resolveBindingConfigSummaryItems,
  resolveBindingKindFromTarget,
  resolveBindingToolToggleModel,
  SandboxProfileBindingConfigEditor,
} from "./sandbox-profile-binding-config-editor.js";
import {
  BindingConnectionField,
  resolveRowBindingMetadata,
} from "./sandbox-profile-binding-shared.js";

export function formatBindingSectionTitle(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Agent Harness";
  }
  if (kind === "git") {
    return "Git Providers";
  }
  return "Connectors";
}

function formatBindingSectionEmptyState(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Assign the agent harness for this sandbox profile.";
  }
  if (kind === "git") {
    return "Add Git providers to give the agent access to resources like repositories.";
  }
  return "Add connectors to give the agent access to external tools and their resources, like Linear or Slack.";
}

export function formatBindingSectionConstraint(kind: SandboxIntegrationBindingKind): string | null {
  if (kind === "agent") {
    return "Only one agent harness can be assigned to a sandbox profile.";
  }
  return null;
}

export function shouldHideBindingSectionAddAction(input: {
  kind: SandboxIntegrationBindingKind;
  rowCount: number;
}): boolean {
  return (input.kind === "agent" || input.kind === "git") && input.rowCount > 0;
}

function serializeBindingRowState(row: Omit<SandboxProfileBindingEditorRow, "clientId">): string {
  return JSON.stringify({
    id: row.id,
    connectionId: row.connectionId,
    kind: row.kind,
    config: row.config,
  });
}

function useDraftBindingRow(row: SandboxProfileBindingEditorRow): {
  draftRow: SandboxProfileBindingEditorRow;
  isDirty: boolean;
  setDraftRow: React.Dispatch<React.SetStateAction<SandboxProfileBindingEditorRow>>;
  resetDraftRow: () => void;
} {
  const persistedSignature = serializeBindingRowState(row);
  const persistedRowRef = React.useRef(row);
  const [draftRow, setDraftRow] = React.useState(row);

  persistedRowRef.current = row;

  React.useEffect(() => {
    setDraftRow(persistedRowRef.current);
  }, [persistedSignature]);

  return {
    draftRow,
    isDirty: serializeBindingRowState(draftRow) !== persistedSignature,
    setDraftRow,
    resetDraftRow: () => {
      setDraftRow(row);
    },
  };
}

function BindingDraftActions(input: {
  isDirty: boolean;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button disabled={!input.isDirty} onClick={input.onCancel} type="button" variant="outline">
        Cancel
      </Button>
      <Button disabled={!input.isDirty} onClick={input.onSave} type="button">
        Save
      </Button>
    </div>
  );
}

function resolveAvailableConnectionsForBindingKind(input: {
  kind: SandboxIntegrationBindingKind;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): readonly IntegrationConnectionSummary[] {
  return input.availableConnections.filter((connection) => {
    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    return resolveBindingKindFromTarget(target) === input.kind;
  });
}

function SchemaBindingConnectionPicker(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  disabled: boolean;
  onCreateBindingFromConnection:
    | ((input: {
        kind: SandboxIntegrationBindingKind;
        connectionId: string;
      }) => Promise<void> | void)
    | undefined;
  kind: SandboxIntegrationBindingKind;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 py-2">
      <BindingConnectionField
        ariaLabel="Connection"
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        disabled={input.disabled}
        onValueChange={(nextValue) => {
          if (input.onCreateBindingFromConnection === undefined) {
            return;
          }
          void input.onCreateBindingFromConnection({
            kind: input.kind,
            connectionId: nextValue,
          });
        }}
        placeholder="Select a connection"
        selectedConnectionId={null}
      />
    </div>
  );
}

function renderSchemaBindingRemoveAction(input: {
  kind: SandboxIntegrationBindingKind;
  row: SandboxProfileBindingEditorRow;
  onRemove: (clientId: string) => void;
}): React.ReactNode {
  if (input.kind !== "git") {
    return undefined;
  }

  return (
    <Button
      aria-label="Remove binding"
      className="mt-6 h-7 w-7 shrink-0"
      onClick={() => {
        input.onRemove(input.row.clientId);
      }}
      type="button"
      variant="ghost"
    >
      <TrashIcon aria-hidden className="size-4" />
    </Button>
  );
}

function SchemaBindingRowEditor(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnectionsForKind: readonly IntegrationConnectionSummary[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  rowError: string | undefined;
  onChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onDraftDirtyChange?: (clientId: string, isDirty: boolean) => void;
  removeAction?: React.ReactNode;
  fieldId: string;
}): React.JSX.Element {
  const { draftRow, isDirty, resetDraftRow, setDraftRow } = useDraftBindingRow(input.row);

  React.useEffect(() => {
    input.onDraftDirtyChange?.(input.row.clientId, isDirty);

    return () => {
      input.onDraftDirtyChange?.(input.row.clientId, false);
    };
  }, [input.onDraftDirtyChange, input.row.clientId, isDirty]);

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-4">
        <BindingConnectionField
          ariaLabel="Connection"
          availableConnections={input.availableConnectionsForKind}
          availableTargets={input.availableTargets}
          id={input.fieldId}
          onValueChange={(nextValue) => {
            const nextConnection = input.availableConnectionsForKind.find(
              (connection) => connection.id === nextValue,
            );
            const nextTarget = input.availableTargets.find(
              (candidate) => candidate.targetKey === nextConnection?.targetKey,
            );

            setDraftRow((currentRow) => ({
              ...currentRow,
              connectionId: nextValue,
              config:
                nextConnection === undefined || nextTarget === undefined
                  ? {}
                  : createDefaultBindingConfig({
                      connection: nextConnection,
                      target: nextTarget,
                    }),
            }));
          }}
          placeholder="Select integration connection"
          selectedConnectionId={draftRow.connectionId}
          trailingAction={input.removeAction}
        />

        <SandboxProfileBindingConfigEditor
          availableConnections={input.availableConnections}
          availableTargets={input.availableTargets}
          formContext={{
            columns: 2,
            labelTone: "detail",
            layout: "vertical",
          }}
          onIntegrationBindingRowChange={(clientId, changes) => {
            setDraftRow((currentRow) =>
              clientId === currentRow.clientId ? { ...currentRow, ...changes } : currentRow,
            );
          }}
          row={draftRow}
        />

        <BindingDraftActions
          isDirty={isDirty}
          onCancel={resetDraftRow}
          onSave={() => {
            input.onChange(input.row.clientId, {
              connectionId: draftRow.connectionId,
              kind: draftRow.kind,
              config: draftRow.config,
            });
          }}
        />

        {input.rowError === undefined ? null : <Notice variant="alert">{input.rowError}</Notice>}
      </div>
    </div>
  );
}

function SchemaBindingRows(input: {
  kind: Extract<SandboxIntegrationBindingKind, "agent" | "git">;
  rows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  rowErrorsByClientId: Readonly<Record<string, string>>;
  onChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onRemove: (clientId: string) => void;
  onDraftDirtyChange?: (clientId: string, isDirty: boolean) => void;
  onCreateBindingFromConnection?: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
  }) => Promise<void> | void;
}): React.JSX.Element {
  const availableConnectionsForKind = resolveAvailableConnectionsForBindingKind({
    kind: input.kind,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });

  return (
    <div className="flex flex-col divide-y">
      {input.rows.length === 0 ? (
        <SchemaBindingConnectionPicker
          availableConnections={availableConnectionsForKind}
          availableTargets={input.availableTargets}
          disabled={
            availableConnectionsForKind.length === 0 ||
            input.onCreateBindingFromConnection === undefined
          }
          kind={input.kind}
          onCreateBindingFromConnection={input.onCreateBindingFromConnection}
        />
      ) : null}
      {input.rows.map((row) => (
        <SchemaBindingRowEditor
          availableConnections={input.availableConnections}
          availableConnectionsForKind={availableConnectionsForKind}
          availableTargets={input.availableTargets}
          fieldId={`${input.kind}-binding-connection-${row.clientId}`}
          key={row.clientId}
          onChange={input.onChange}
          row={row}
          rowError={input.rowErrorsByClientId[row.clientId]}
          {...(input.onDraftDirtyChange === undefined
            ? {}
            : { onDraftDirtyChange: input.onDraftDirtyChange })}
          {...(input.kind !== "git"
            ? {}
            : {
                removeAction: renderSchemaBindingRemoveAction({
                  kind: input.kind,
                  onRemove: input.onRemove,
                  row,
                }),
              })}
        />
      ))}
    </div>
  );
}

function ConnectorBindingRows(input: {
  rows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  rowErrorsByClientId: Readonly<Record<string, string>>;
  onEdit: (row: SandboxProfileBindingEditorRow) => void;
  onChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onRemove: (clientId: string) => void;
  emptyStateAction: React.ReactNode | undefined;
  emptyStateMessage: string | undefined;
}): React.JSX.Element {
  function renderToolContent(params: {
    row: SandboxProfileBindingEditorRow;
    toolToggleModel: ReturnType<typeof resolveBindingToolToggleModel>;
    rowErrorMessage: string | undefined;
    detailLabelClassName?: string;
    showLabel?: boolean;
  }): React.JSX.Element {
    const supportedToolToggleModel =
      params.toolToggleModel.mode === "supported" ? params.toolToggleModel : undefined;
    const unsupportedToolToggleMessage =
      params.toolToggleModel.mode === "unsupported" ? params.toolToggleModel.message : undefined;

    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        {params.showLabel === false ? null : (
          <DetailLabel as="p" className={params.detailLabelClassName}>
            Tools
          </DetailLabel>
        )}
        {supportedToolToggleModel === undefined ? (
          <p className="text-sm text-destructive">{unsupportedToolToggleMessage}</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {supportedToolToggleModel.options.map((option) => (
              <label className="flex items-center gap-1.5 select-none" key={option.value}>
                <Checkbox
                  aria-label={option.label}
                  checked={option.checked}
                  onCheckedChange={(checked) => {
                    input.onChange(params.row.clientId, {
                      config: {
                        ...supportedToolToggleModel.config,
                        tools:
                          checked === true
                            ? supportedToolToggleModel.options
                                .filter(
                                  (candidate) =>
                                    candidate.checked || candidate.value === option.value,
                                )
                                .map((candidate) => candidate.value)
                            : supportedToolToggleModel.options
                                .filter(
                                  (candidate) =>
                                    candidate.checked && candidate.value !== option.value,
                                )
                                .map((candidate) => candidate.value),
                      },
                    });
                  }}
                />
                <span className="text-sm select-none">{option.label}</span>
              </label>
            ))}
          </div>
        )}
        {params.rowErrorMessage === undefined ? null : (
          <Notice variant="alert">{params.rowErrorMessage}</Notice>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground hidden border-b py-2 text-xs uppercase tracking-wide md:grid md:grid-cols-[minmax(0,12rem)_minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center md:gap-x-4">
        <p>Integration</p>
        <p>Connection</p>
        <p>Configuration</p>
        <div />
      </div>
      {input.rows.length === 0 ? (
        <div className="border-b py-4">
          <ActionTile
            action={input.emptyStateAction}
            className="border-0 px-0 py-0 shadow-none"
            description={input.emptyStateMessage ?? ""}
            title={<span className="sr-only">Add connectors</span>}
          />
        </div>
      ) : null}
      <div className="hidden md:flex md:flex-col">
        {input.rows.map((row) => {
          const rowMetadata = resolveRowBindingMetadata({
            row,
            availableConnections: input.availableConnections,
            availableTargets: input.availableTargets,
          });
          const target = rowMetadata?.target;
          const connectionDisplayName =
            rowMetadata === null
              ? undefined
              : formatConnectionDisplayName({
                  connection: rowMetadata.connection,
                });
          const toolToggleModel = resolveBindingToolToggleModel({
            row,
            connections: input.availableConnections,
            targets: input.availableTargets,
          });
          const rowErrorMessage = input.rowErrorsByClientId[row.clientId];
          const summaryItems = resolveBindingConfigSummaryItems({
            row,
            connections: input.availableConnections,
            targets: input.availableTargets,
            excludedPropertyKeys: ["tools"],
            maxItems: 3,
          });
          const configSummary =
            summaryItems.length === 0 ? null : (
              <div className="flex min-w-0 flex-col gap-2">
                {summaryItems.map((item) => (
                  <div className="min-w-0" key={item.label}>
                    <DetailLabel as="p">{item.label}</DetailLabel>
                    <p className="truncate text-sm">{item.value}</p>
                  </div>
                ))}
              </div>
            );
          const showEditAction = summaryItems.length > 0;

          return (
            <div
              className="grid border-b py-4 md:grid-cols-[minmax(0,12rem)_minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center md:gap-x-4"
              key={row.clientId}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  {target?.logoKey ? (
                    <img
                      alt={`${target.displayName} logo`}
                      className="h-5 w-5 rounded-sm"
                      src={resolveIntegrationLogoPath({ logoKey: target.logoKey })}
                    />
                  ) : (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
                      {(target?.displayName ?? "I").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <p className="truncate text-sm font-medium">
                    {target?.displayName ?? "Integration"}
                  </p>
                </div>
              </div>
              <div className="text-muted-foreground min-w-0 text-sm">
                <p className="truncate">{connectionDisplayName ?? row.connectionId}</p>
              </div>
              <div>
                <div className="flex min-w-0 flex-col gap-3">
                  {configSummary}
                  {renderToolContent({
                    row,
                    toolToggleModel,
                    rowErrorMessage,
                    showLabel: false,
                  })}
                </div>
              </div>
              <div className="flex justify-end">
                <div className="flex items-center gap-1">
                  {showEditAction ? (
                    <Button
                      aria-label="Edit binding"
                      className="h-7 w-7"
                      onClick={() => {
                        input.onEdit(row);
                      }}
                      type="button"
                      variant="ghost"
                    >
                      <PencilSimpleIcon aria-hidden className="size-4" />
                    </Button>
                  ) : null}
                  <Button
                    aria-label="Remove binding"
                    className="h-7 w-7"
                    onClick={() => {
                      input.onRemove(row.clientId);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <TrashIcon aria-hidden className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-col md:hidden">
        {input.rows.map((row) => {
          const rowMetadata = resolveRowBindingMetadata({
            row,
            availableConnections: input.availableConnections,
            availableTargets: input.availableTargets,
          });
          const target = rowMetadata?.target;
          const connectionDisplayName =
            rowMetadata === null
              ? undefined
              : formatConnectionDisplayName({
                  connection: rowMetadata.connection,
                });
          const toolToggleModel = resolveBindingToolToggleModel({
            row,
            connections: input.availableConnections,
            targets: input.availableTargets,
          });
          const rowErrorMessage = input.rowErrorsByClientId[row.clientId];
          const summaryItems = resolveBindingConfigSummaryItems({
            row,
            connections: input.availableConnections,
            targets: input.availableTargets,
            excludedPropertyKeys: ["tools"],
            maxItems: 3,
          });
          const configSummary =
            summaryItems.length === 0 ? null : (
              <div className="flex min-w-0 flex-col gap-2">
                {summaryItems.map((item) => (
                  <div className="min-w-0" key={item.label}>
                    <DetailLabel as="p">{item.label}</DetailLabel>
                    <p className="truncate text-sm">{item.value}</p>
                  </div>
                ))}
              </div>
            );
          const showEditAction = summaryItems.length > 0;

          return (
            <div className="relative grid gap-4 border-b py-4 pr-20" key={row.clientId}>
              <div className="min-w-0 flex items-start gap-3">
                {target?.logoKey ? (
                  <img
                    alt={`${target.displayName} logo`}
                    className="h-5 w-5 rounded-sm"
                    src={resolveIntegrationLogoPath({ logoKey: target.logoKey })}
                  />
                ) : (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold text-muted-foreground">
                    {(target?.displayName ?? "I").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex flex-col gap-0.5">
                  <p className="truncate text-sm font-medium">
                    {target?.displayName ?? "Integration"}
                  </p>
                  <p className="text-muted-foreground truncate text-sm">
                    {connectionDisplayName ?? row.connectionId}
                  </p>
                  <div className="flex min-w-0 flex-col gap-4 pt-4">
                    {configSummary}
                    {renderToolContent({
                      row,
                      toolToggleModel,
                      rowErrorMessage,
                      showLabel: false,
                    })}
                  </div>
                </div>
              </div>
              <div className="absolute top-4 right-0 flex items-center gap-1 self-start">
                {showEditAction ? (
                  <Button
                    aria-label="Edit binding"
                    className="h-7 w-7"
                    onClick={() => {
                      input.onEdit(row);
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <PencilSimpleIcon aria-hidden className="size-4" />
                  </Button>
                ) : null}
                <Button
                  aria-label="Remove binding"
                  className="h-7 w-7"
                  onClick={() => {
                    input.onRemove(row.clientId);
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
  );
}

export function SandboxProfileBindingSection(input: {
  kind: SandboxIntegrationBindingKind;
  rows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  addDisabled: boolean;
  rowErrorsByClientId: Readonly<Record<string, string>>;
  onAdd: () => void;
  onEdit: (row: SandboxProfileBindingEditorRow) => void;
  onRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onRemove: (clientId: string) => void;
  showSectionChrome?: boolean;
  onRowDraftDirtyChange?: (clientId: string, isDirty: boolean) => void;
  onCreateBindingFromConnection?: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
  }) => Promise<void> | void;
}): React.JSX.Element {
  const showSectionChrome = input.showSectionChrome ?? true;
  const availableConnectionsForKind = input.availableConnections.filter((connection) => {
    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    return resolveBindingKindFromTarget(target) === input.kind;
  });
  const addConstraintMessage =
    input.rows.length > 0 && input.addDisabled ? formatBindingSectionConstraint(input.kind) : null;
  const hideAddAction = shouldHideBindingSectionAddAction({
    kind: input.kind,
    rowCount: input.rows.length,
  });
  const addButton = (
    <Button disabled={input.addDisabled} onClick={input.onAdd} type="button" variant="outline">
      <PlusIcon />
      Add
    </Button>
  );

  const sectionContent =
    input.kind === "connector" ? (
      <ConnectorBindingRows
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        emptyStateAction={input.rows.length === 0 ? addButton : undefined}
        emptyStateMessage={
          input.rows.length === 0 ? formatBindingSectionEmptyState(input.kind) : undefined
        }
        onEdit={input.onEdit}
        onChange={input.onRowChange}
        onRemove={input.onRemove}
        rowErrorsByClientId={input.rowErrorsByClientId}
        rows={input.rows}
      />
    ) : input.kind === "agent" ? (
      <SchemaBindingRows
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        kind="agent"
        onChange={input.onRowChange}
        onRemove={input.onRemove}
        rowErrorsByClientId={input.rowErrorsByClientId}
        rows={input.rows}
        {...(input.onRowDraftDirtyChange === undefined
          ? {}
          : { onDraftDirtyChange: input.onRowDraftDirtyChange })}
        {...(input.onCreateBindingFromConnection === undefined
          ? {}
          : { onCreateBindingFromConnection: input.onCreateBindingFromConnection })}
      />
    ) : input.kind === "git" ? (
      <SchemaBindingRows
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        kind="git"
        onChange={input.onRowChange}
        onRemove={input.onRemove}
        rowErrorsByClientId={input.rowErrorsByClientId}
        rows={input.rows}
        {...(input.onRowDraftDirtyChange === undefined
          ? {}
          : { onDraftDirtyChange: input.onRowDraftDirtyChange })}
        {...(input.onCreateBindingFromConnection === undefined
          ? {}
          : { onCreateBindingFromConnection: input.onCreateBindingFromConnection })}
      />
    ) : (
      <div className="flex flex-col divide-y">
        {input.rows.map((row) => (
          <SandboxProfileBindingCard
            availableConnections={input.availableConnections}
            availableTargets={input.availableTargets}
            errorMessage={input.rowErrorsByClientId[row.clientId]}
            key={row.clientId}
            onEdit={() => {
              input.onEdit(row);
            }}
            onRemove={() => {
              input.onRemove(row.clientId);
            }}
            row={row}
          />
        ))}
      </div>
    );

  if (!showSectionChrome) {
    return sectionContent;
  }

  if (input.rows.length === 0) {
    return (
      <SectionBlock
        action={
          ((input.kind === "agent" || input.kind === "git") &&
            availableConnectionsForKind.length > 0) ||
          hideAddAction ? null : addConstraintMessage === null ? (
            addButton
          ) : (
            <Tooltip delay={0}>
              <TooltipTrigger render={<span className="inline-flex" />}>{addButton}</TooltipTrigger>
              <TooltipContent side="top">{addConstraintMessage}</TooltipContent>
            </Tooltip>
          )
        }
        {...(((input.kind === "agent" || input.kind === "git") &&
          availableConnectionsForKind.length > 0) ||
        input.rows.length > 0
          ? { children: sectionContent }
          : { emptyState: formatBindingSectionEmptyState(input.kind) })}
        title={formatBindingSectionTitle(input.kind)}
      />
    );
  }

  return (
    <SectionBlock
      action={
        hideAddAction ? null : addConstraintMessage === null ? (
          addButton
        ) : (
          <Tooltip delay={0}>
            <TooltipTrigger render={<span className="inline-flex" />}>{addButton}</TooltipTrigger>
            <TooltipContent side="top">{addConstraintMessage}</TooltipContent>
          </Tooltip>
        )
      }
      children={sectionContent}
      title={formatBindingSectionTitle(input.kind)}
    />
  );
}
