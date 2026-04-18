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
import { SandboxProfileBindingCard } from "./sandbox-profile-binding-card.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { resolveBindingToolToggleModel } from "./sandbox-profile-binding-config-editor.js";
import { formatSandboxProfileBindingSummaryItems } from "./sandbox-profile-binding-summary.js";

function formatBindingSectionTitle(kind: SandboxIntegrationBindingKind): string {
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

function formatBindingSectionConstraint(kind: SandboxIntegrationBindingKind): string | null {
  if (kind === "agent") {
    return "Only one agent harness can be assigned to a sandbox profile.";
  }
  return null;
}

function resolveRowBindingMetadata(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): {
  connection: IntegrationConnectionSummary;
  target: IntegrationTargetSummary | undefined;
} | null {
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.row.connectionId,
  );
  if (connection === undefined) {
    return null;
  }

  return {
    connection,
    target: input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    ),
  };
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
}): React.JSX.Element {
  function resolveConfigSummaryItems(params: { row: SandboxProfileBindingEditorRow }) {
    return formatSandboxProfileBindingSummaryItems({
      row: params.row,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
      excludedPropertyKeys: ["tools"],
      maxItems: 3,
    });
  }

  function renderConfigSummary(params: {
    summaryItems: ReturnType<typeof resolveConfigSummaryItems>;
  }): React.JSX.Element | null {
    const summaryItems = params.summaryItems;

    if (summaryItems.length === 0) {
      return null;
    }

    return (
      <div className="flex min-w-0 flex-col gap-2">
        {summaryItems.map((item) => (
          <div className="min-w-0" key={item.label}>
            <DetailLabel as="p">{item.label}</DetailLabel>
            <p className="truncate text-sm">{item.value}</p>
          </div>
        ))}
      </div>
    );
  }

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
          const summaryItems = resolveConfigSummaryItems({
            row,
          });
          const configSummary = renderConfigSummary({
            summaryItems,
          });
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
          const summaryItems = resolveConfigSummaryItems({
            row,
          });
          const configSummary = renderConfigSummary({
            summaryItems,
          });
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
}): React.JSX.Element {
  const addConstraintMessage =
    input.rows.length > 0 && input.addDisabled ? formatBindingSectionConstraint(input.kind) : null;
  const addButton = (
    <Button disabled={input.addDisabled} onClick={input.onAdd} type="button" variant="outline">
      <PlusIcon />
      Add
    </Button>
  );

  if (input.rows.length === 0) {
    return (
      <SectionBlock
        action={
          addConstraintMessage === null ? (
            addButton
          ) : (
            <Tooltip delay={0}>
              <TooltipTrigger render={<span className="inline-flex" />}>{addButton}</TooltipTrigger>
              <TooltipContent side="top">{addConstraintMessage}</TooltipContent>
            </Tooltip>
          )
        }
        emptyState={formatBindingSectionEmptyState(input.kind)}
        title={formatBindingSectionTitle(input.kind)}
      />
    );
  }

  return (
    <SectionBlock
      action={
        addConstraintMessage === null ? (
          addButton
        ) : (
          <Tooltip delay={0}>
            <TooltipTrigger render={<span className="inline-flex" />}>{addButton}</TooltipTrigger>
            <TooltipContent side="top">{addConstraintMessage}</TooltipContent>
          </Tooltip>
        )
      }
      children={
        input.kind === "connector" ? (
          <ConnectorBindingRows
            availableConnections={input.availableConnections}
            availableTargets={input.availableTargets}
            onEdit={input.onEdit}
            onChange={input.onRowChange}
            onRemove={input.onRemove}
            rowErrorsByClientId={input.rowErrorsByClientId}
            rows={input.rows}
          />
        ) : (
          input.rows.map((row) => (
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
          ))
        )
      }
      title={formatBindingSectionTitle(input.kind)}
    />
  );
}
