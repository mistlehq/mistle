import {
  Button,
  Checkbox,
  DetailLabel,
  Notice,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { InfoIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import * as React from "react";

import { IntegrationSelectContentClassName } from "../forms/schema-form.js";
import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { ActionTile } from "../shared/action-tile.js";
import { resolveSelectableValue } from "../shared/select-value.js";
import { IntegrationConnectionSelect } from "./integration-connection-select.js";
import { SandboxProfileBindingCard } from "./sandbox-profile-binding-card.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  resolveBindingConfigUiModel,
  resolveBindingToolToggleModel,
  SandboxProfileBindingConfigEditor,
} from "./sandbox-profile-binding-config-editor.js";
import { formatSandboxProfileBindingSummaryItems } from "./sandbox-profile-binding-summary.js";

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

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveNestedRecord(input: {
  value: Record<string, unknown>;
  path: readonly string[];
}): Record<string, unknown> | null {
  let current: unknown = input.value;
  for (const key of input.path) {
    const currentRecord = readRecord(current);
    if (currentRecord === null) {
      return null;
    }
    current = currentRecord[key];
  }
  return readRecord(current);
}

function resolveNestedSchemaValue(input: {
  value: Record<string, unknown>;
  path: readonly string[];
}): unknown {
  let current: unknown = input.value;
  for (const key of input.path) {
    const currentRecord = readRecord(current);
    if (currentRecord === null) {
      return undefined;
    }
    current = currentRecord[key];
  }
  return current;
}

function resolveChoiceOptions(input: {
  schema: Record<string, unknown>;
  uiSchema: Record<string, unknown>;
  schemaPath: readonly string[];
  uiSchemaPath: readonly string[];
}): readonly { label: string; value: string }[] {
  const schemaValue = resolveNestedSchemaValue({
    value: input.schema,
    path: input.schemaPath,
  });
  const uiSchemaValue = resolveNestedSchemaValue({
    value: input.uiSchema,
    path: input.uiSchemaPath,
  });
  const schemaRecord = readRecord(schemaValue);
  const uiSchemaRecord = readRecord(uiSchemaValue);

  const oneOf = schemaRecord?.["oneOf"];
  if (Array.isArray(oneOf)) {
    return oneOf.flatMap((option) => {
      const optionRecord = readRecord(option);
      const value = readString(optionRecord?.["const"]);
      const label = readString(optionRecord?.["title"]);
      return value === undefined || label === undefined ? [] : [{ label, value }];
    });
  }

  const enumValues = schemaRecord?.["enum"];
  if (!Array.isArray(enumValues)) {
    return [];
  }

  const enumNames = Array.isArray(uiSchemaRecord?.["ui:enumNames"])
    ? uiSchemaRecord["ui:enumNames"]
    : [];

  return enumValues.flatMap((option, index) => {
    const value = readString(option);
    if (value === undefined) {
      return [];
    }
    const enumName = enumNames[index];
    return [
      {
        label: typeof enumName === "string" ? enumName : value,
        value,
      },
    ];
  });
}

function updateAgentHarnessConfig(input: {
  config: Record<string, unknown>;
  defaultModel?: string;
  reasoningEffort?: string;
  additionalInstructions?: string;
}): Record<string, unknown> {
  const currentModel = resolveNestedRecord({
    path: ["model"],
    value: input.config,
  });
  const currentOptions = resolveNestedRecord({
    path: ["model", "options"],
    value: input.config,
  });

  const nextOptions: Record<string, unknown> = {
    ...(currentOptions ?? {}),
    ...(input.reasoningEffort === undefined
      ? {}
      : {
          reasoningEffort: input.reasoningEffort,
        }),
  };
  if (input.additionalInstructions !== undefined) {
    if (input.additionalInstructions.trim().length === 0) {
      delete nextOptions["additionalInstructions"];
    } else {
      nextOptions["additionalInstructions"] = input.additionalInstructions;
    }
  }

  return {
    ...input.config,
    model: {
      ...(currentModel ?? {}),
      ...(input.defaultModel === undefined
        ? {}
        : {
            defaultModel: input.defaultModel,
          }),
      options: nextOptions,
    },
  };
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

function AgentHarnessConnectionPicker(input: {
  availableAgentConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onCreateBindingFromConnection:
    | ((input: {
        kind: SandboxIntegrationBindingKind;
        connectionId: string;
      }) => Promise<void> | void)
    | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <DetailLabel as="p">Connection</DetailLabel>
        <IntegrationConnectionSelect
          ariaLabel="Connection"
          availableConnections={input.availableAgentConnections}
          availableTargets={input.availableTargets}
          disabled={
            input.availableAgentConnections.length === 0 ||
            input.onCreateBindingFromConnection === undefined
          }
          onValueChange={(nextValue) => {
            if (input.onCreateBindingFromConnection === undefined) {
              return;
            }
            void input.onCreateBindingFromConnection({
              kind: "agent",
              connectionId: nextValue,
            });
          }}
          placeholder="Select a connection"
          selectedConnectionId={null}
        />
      </div>
    </div>
  );
}

function AgentHarnessRowEditor(input: {
  row: SandboxProfileBindingEditorRow;
  availableAgentConnections: readonly IntegrationConnectionSummary[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  rowError: string | undefined;
  onChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onDraftDirtyChange?: (clientId: string, isDirty: boolean) => void;
}): React.JSX.Element {
  const { draftRow, isDirty, resetDraftRow, setDraftRow } = useDraftBindingRow(input.row);

  React.useEffect(() => {
    input.onDraftDirtyChange?.(input.row.clientId, isDirty);

    return () => {
      input.onDraftDirtyChange?.(input.row.clientId, false);
    };
  }, [input.onDraftDirtyChange, input.row.clientId, isDirty]);

  const fieldId = `agent-binding-connection-${input.row.clientId}`;
  const configUiModel = resolveBindingConfigUiModel({
    row: draftRow,
    connections: input.availableConnections,
    targets: input.availableTargets,
  });
  const schemaRecord = configUiModel.mode === "form" ? readRecord(configUiModel.schema) : null;
  const uiSchemaRecord = configUiModel.mode === "form" ? readRecord(configUiModel.uiSchema) : null;
  const defaultModelOptions =
    schemaRecord === null || uiSchemaRecord === null
      ? []
      : resolveChoiceOptions({
          schema: schemaRecord,
          uiSchema: uiSchemaRecord,
          schemaPath: ["properties", "model", "properties", "defaultModel"],
          uiSchemaPath: ["model", "defaultModel"],
        });
  const reasoningEffortOptions =
    schemaRecord === null || uiSchemaRecord === null
      ? []
      : resolveChoiceOptions({
          schema: schemaRecord,
          uiSchema: uiSchemaRecord,
          schemaPath: [
            "properties",
            "model",
            "properties",
            "options",
            "properties",
            "reasoningEffort",
          ],
          uiSchemaPath: ["model", "options", "reasoningEffort"],
        });
  const currentDefaultModel =
    configUiModel.mode !== "form"
      ? undefined
      : readString(
          resolveNestedSchemaValue({
            path: ["model", "defaultModel"],
            value: configUiModel.value,
          }),
        );
  const currentReasoningEffort =
    configUiModel.mode !== "form"
      ? undefined
      : readString(
          resolveNestedSchemaValue({
            path: ["model", "options", "reasoningEffort"],
            value: configUiModel.value,
          }),
        );
  const currentAdditionalInstructions =
    configUiModel.mode !== "form"
      ? undefined
      : readString(
          resolveNestedSchemaValue({
            path: ["model", "options", "additionalInstructions"],
            value: configUiModel.value,
          }),
        );
  const canRenderExplicitAgentForm =
    configUiModel.mode === "form" &&
    defaultModelOptions.length > 0 &&
    reasoningEffortOptions.length > 0;

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <DetailLabel as="p">Connection</DetailLabel>
            <IntegrationConnectionSelect
              ariaLabel="Connection"
              availableConnections={input.availableAgentConnections}
              availableTargets={input.availableTargets}
              id={fieldId}
              onValueChange={(nextValue) => {
                const nextConnection = input.availableAgentConnections.find(
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
            />
          </div>
        </div>

        {canRenderExplicitAgentForm ? (
          <>
            <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
              <div className="min-w-0 flex flex-col gap-1.5">
                <DetailLabel as="p">Default model</DetailLabel>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === null || configUiModel.mode !== "form") {
                      return;
                    }

                    setDraftRow((currentRow) => ({
                      ...currentRow,
                      config: updateAgentHarnessConfig({
                        config: configUiModel.value,
                        defaultModel: nextValue,
                      }),
                    }));
                  }}
                  value={resolveSelectableValue({
                    selectedValue: currentDefaultModel ?? null,
                    optionValues: defaultModelOptions.map((option) => option.value),
                  })}
                >
                  <SelectTrigger aria-label="Default model" className="w-full">
                    <SelectValue placeholder="Select model">{currentDefaultModel}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className={IntegrationSelectContentClassName}>
                    {defaultModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="min-w-0 flex flex-col gap-1.5">
                <DetailLabel as="p">Reasoning effort</DetailLabel>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === null || configUiModel.mode !== "form") {
                      return;
                    }

                    setDraftRow((currentRow) => ({
                      ...currentRow,
                      config: updateAgentHarnessConfig({
                        config: configUiModel.value,
                        reasoningEffort: nextValue,
                      }),
                    }));
                  }}
                  value={resolveSelectableValue({
                    selectedValue: currentReasoningEffort ?? null,
                    optionValues: reasoningEffortOptions.map((option) => option.value),
                  })}
                >
                  <SelectTrigger aria-label="Reasoning effort" className="w-full">
                    <SelectValue placeholder="Select reasoning effort">
                      {currentReasoningEffort}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className={IntegrationSelectContentClassName}>
                    {reasoningEffortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="min-w-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <DetailLabel as="p">Agent Instructions</DetailLabel>
                <Tooltip delay={0}>
                  <TooltipTrigger
                    aria-label="Explain agent instructions"
                    render={
                      <button
                        className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
                        type="button"
                      />
                    }
                  >
                    <InfoIcon aria-hidden className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-64 text-left" side="top">
                    Appended to the developer message.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Textarea
                aria-label="Agent Instructions"
                className="min-h-28 w-full text-sm"
                onChange={(event) => {
                  if (configUiModel.mode !== "form") {
                    return;
                  }
                  const nextInstructions = event.currentTarget.value;

                  setDraftRow((currentRow) => ({
                    ...currentRow,
                    config: updateAgentHarnessConfig({
                      config: configUiModel.value,
                      additionalInstructions: nextInstructions,
                    }),
                  }));
                }}
                rows={8}
                value={currentAdditionalInstructions ?? ""}
              />
            </div>
          </>
        ) : (
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
        )}

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

function AgentHarnessRows(input: {
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
  const availableAgentConnections = input.availableConnections.filter((connection) => {
    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    return resolveBindingKindFromTarget(target) === "agent";
  });

  return (
    <div className="flex flex-col divide-y">
      {input.rows.length === 0 ? (
        <AgentHarnessConnectionPicker
          availableAgentConnections={availableAgentConnections}
          availableTargets={input.availableTargets}
          onCreateBindingFromConnection={input.onCreateBindingFromConnection}
        />
      ) : null}
      {input.rows.map((row) => (
        <AgentHarnessRowEditor
          availableAgentConnections={availableAgentConnections}
          availableConnections={input.availableConnections}
          availableTargets={input.availableTargets}
          key={row.clientId}
          onChange={input.onChange}
          row={row}
          rowError={input.rowErrorsByClientId[row.clientId]}
          {...(input.onDraftDirtyChange === undefined
            ? {}
            : { onDraftDirtyChange: input.onDraftDirtyChange })}
        />
      ))}
    </div>
  );
}

function GitProviderConnectionPicker(input: {
  availableGitConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  onCreateBindingFromConnection:
    | ((input: {
        kind: SandboxIntegrationBindingKind;
        connectionId: string;
      }) => Promise<void> | void)
    | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <DetailLabel as="p">Connection</DetailLabel>
        <IntegrationConnectionSelect
          ariaLabel="Connection"
          availableConnections={input.availableGitConnections}
          availableTargets={input.availableTargets}
          disabled={
            input.availableGitConnections.length === 0 ||
            input.onCreateBindingFromConnection === undefined
          }
          onValueChange={(nextValue) => {
            if (input.onCreateBindingFromConnection === undefined) {
              return;
            }
            void input.onCreateBindingFromConnection({
              kind: "git",
              connectionId: nextValue,
            });
          }}
          placeholder="Select a connection"
          selectedConnectionId={null}
        />
      </div>
    </div>
  );
}

function GitProviderRowEditor(input: {
  row: SandboxProfileBindingEditorRow;
  availableGitConnections: readonly IntegrationConnectionSummary[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  rowError: string | undefined;
  onChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onRemove: (clientId: string) => void;
  onDraftDirtyChange?: (clientId: string, isDirty: boolean) => void;
}): React.JSX.Element {
  const { draftRow, isDirty, resetDraftRow, setDraftRow } = useDraftBindingRow(input.row);

  React.useEffect(() => {
    input.onDraftDirtyChange?.(input.row.clientId, isDirty);

    return () => {
      input.onDraftDirtyChange?.(input.row.clientId, false);
    };
  }, [input.onDraftDirtyChange, input.row.clientId, isDirty]);

  const fieldId = `git-binding-connection-${input.row.clientId}`;

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <DetailLabel as="p">Connection</DetailLabel>
            <IntegrationConnectionSelect
              ariaLabel="Connection"
              availableConnections={input.availableGitConnections}
              availableTargets={input.availableTargets}
              id={fieldId}
              onValueChange={(nextValue) => {
                const nextConnection = input.availableGitConnections.find(
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
            />
          </div>
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
        </div>

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

function GitProviderRows(input: {
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
  const availableGitConnections = input.availableConnections.filter((connection) => {
    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    return resolveBindingKindFromTarget(target) === "git";
  });

  return (
    <div className="flex flex-col divide-y">
      {input.rows.length === 0 ? (
        <GitProviderConnectionPicker
          availableGitConnections={availableGitConnections}
          availableTargets={input.availableTargets}
          onCreateBindingFromConnection={input.onCreateBindingFromConnection}
        />
      ) : null}
      {input.rows.map((row) => (
        <GitProviderRowEditor
          availableConnections={input.availableConnections}
          availableGitConnections={availableGitConnections}
          availableTargets={input.availableTargets}
          key={row.clientId}
          onChange={input.onChange}
          onRemove={input.onRemove}
          row={row}
          rowError={input.rowErrorsByClientId[row.clientId]}
          {...(input.onDraftDirtyChange === undefined
            ? {}
            : { onDraftDirtyChange: input.onDraftDirtyChange })}
        />
      ))}
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
      <AgentHarnessRows
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
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
      <GitProviderRows
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
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
