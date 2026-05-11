import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Notice,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextLink,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type React from "react";
import { useState } from "react";
import { Link as RouterLink } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { ActionTile } from "../shared/action-tile.js";
import {
  ResponsiveFieldList,
  ResponsiveFieldListCell,
  type ResponsiveFieldListColumn,
  ResponsiveFieldListRow,
} from "../shared/responsive-field-list.js";
import {
  createDefaultBindingConfig,
  resolveBindingKindFromTarget,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { resolveRowBindingMetadata } from "./sandbox-profile-binding-shared.js";
import {
  hasSandboxProfileBindingResourcesAndToolsCellContent,
  SandboxProfileBindingResourcesAndToolsCell,
} from "./sandbox-profile-resources-and-tools-section.js";
import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";

type IntegrationChoice = {
  id: string;
  kind: SandboxIntegrationBindingKind;
  hasSelectableConnections: boolean;
  logoKey: string | undefined;
  title: React.ReactNode;
};

type SandboxProfileIntegrationsSetupSectionProps = {
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
  onIntegrationSaveErrorDismiss: () => void;
  runtimeSettings: React.ReactNode | null;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
};

type SandboxProfileRuntimeIntegrationRowsProps = Pick<
  SandboxProfileIntegrationsSetupSectionProps,
  | "integrationRows"
  | "availableConnections"
  | "availableTargets"
  | "onAddIntegrationBindingRow"
  | "onIntegrationBindingRowChange"
  | "onRemoveIntegrationBindingRow"
  | "disabled"
  | "readOnly"
>;

const NoIntegrationValue = "none";

const SandboxProfileToolsColumns = [
  { key: "integration", label: "Integration", desktopWidth: "minmax(12rem,0.9fr)" },
  {
    key: "resources-and-tools",
    label: "Resources & Tools",
    desktopWidth: "minmax(16rem,1.35fr)",
    hideMobileLabel: true,
  },
  {
    key: "actions",
    label: <span className="sr-only">Actions</span>,
    desktopWidth: "2rem",
    align: "end",
    hideMobileLabel: true,
  },
] satisfies readonly ResponsiveFieldListColumn[];

const SandboxProfileProxiedConnectionColumns = [
  { key: "connection", label: "Connection", desktopWidth: "minmax(10rem,0.8fr)" },
  { key: "account", label: "Account", desktopWidth: "minmax(14rem,1fr)" },
  {
    key: "actions",
    label: <span className="sr-only">Actions</span>,
    desktopWidth: "2rem",
    align: "end",
    hideMobileLabel: true,
  },
] satisfies readonly ResponsiveFieldListColumn[];

const SandboxProfileIntegrationCellContentClassName = "flex items-center md:min-h-9";
const SandboxProfileIntegrationActionCellClassName =
  "absolute right-0 top-0 md:static md:flex md:justify-end";

function RuntimeSettingLabel(input: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className={`${SandboxProfileIntegrationCellContentClassName} text-sm font-medium`}>
      {input.children}
    </div>
  );
}

function IntegrationNameCell(input: { item: IntegrationChoice }): React.JSX.Element {
  return (
    <div className={`${SandboxProfileIntegrationCellContentClassName} gap-2 text-sm`}>
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

function ConnectionNameCell(input: { displayName: string }): React.JSX.Element {
  return (
    <div className={`${SandboxProfileIntegrationCellContentClassName} text-sm`}>
      <span className="min-w-0 truncate">{input.displayName}</span>
    </div>
  );
}

function IntegrationSelectionCell(input: {
  ariaLabel: string;
  choices: readonly IntegrationChoice[];
  selectedIntegrationId: string;
  onIntegrationChange: (nextIntegrationId: string) => void;
  allowNone?: boolean;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
}): React.JSX.Element {
  const selectedIntegration = input.choices.find(
    (choice) => choice.id === input.selectedIntegrationId,
  );

  if (input.readOnly === true) {
    return selectedIntegration === undefined ? (
      <div className={SandboxProfileIntegrationCellContentClassName}>
        <p className="text-muted-foreground text-sm">None</p>
      </div>
    ) : (
      <IntegrationNameCell item={selectedIntegration} />
    );
  }

  return (
    <Select
      disabled={input.disabled === true}
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
      <SelectContent>
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
  selectedConnectionId: string | undefined;
  onConnectionChange: (nextConnectionId: string) => void;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
}): React.JSX.Element {
  const selectedConnection = input.availableConnections.find(
    (connection) => connection.id === input.selectedConnectionId,
  );
  if (input.availableConnections.length === 0) {
    return (
      <div className={SandboxProfileIntegrationCellContentClassName}>
        <p className="text-muted-foreground text-sm">No connections available.</p>
      </div>
    );
  }

  if (input.readOnly === true) {
    return selectedConnection === undefined ? (
      <div className={SandboxProfileIntegrationCellContentClassName}>
        <p className="text-muted-foreground text-sm">Choose a connection</p>
      </div>
    ) : (
      <ConnectionNameCell displayName={selectedConnection.displayName} />
    );
  }

  return (
    <Select
      disabled={input.disabled === true}
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
            <ConnectionNameCell displayName={selectedConnection.displayName} />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {input.availableConnections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            {connection.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RemoveIntegrationBindingButton(input: {
  label: string;
  disabled?: boolean | undefined;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <Button
      aria-label={input.label}
      className="h-7 w-7"
      disabled={input.disabled === true}
      onClick={input.onRemove}
      type="button"
      variant="ghost"
    >
      <TrashIcon aria-hidden className="size-4" />
    </Button>
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
          <TextLink
            className="text-sm font-medium"
            opensInNewWindow
            render={<RouterLink to={`/integrations/${input.choice.id}/add`} />}
          >
            Setup integration
          </TextLink>
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
  return (
    <div className={SandboxProfileIntegrationCellContentClassName}>
      <p className="text-destructive text-sm">{input.message}</p>
    </div>
  );
}

function UnresolvedIntegrationCell(input: { title: string }): React.JSX.Element {
  return (
    <div className={SandboxProfileIntegrationCellContentClassName}>
      <p className="text-destructive truncate text-sm">{input.title}</p>
    </div>
  );
}

function UnresolvedNoneCell(): React.JSX.Element {
  return (
    <div className={SandboxProfileIntegrationCellContentClassName}>
      <p className="text-sm">None</p>
    </div>
  );
}

function NoGitProvidersCell(): React.JSX.Element {
  return (
    <div className={SandboxProfileIntegrationCellContentClassName}>
      <p className="text-muted-foreground text-sm">No git providers setup</p>
    </div>
  );
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

function resolveConnectorRowPresentation(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): {
  connection: IntegrationConnectionSummary | undefined;
  connectionMessage: string | null;
  logoKey: string | undefined;
  target: IntegrationTargetSummary | undefined;
  title: string;
} {
  const rowMetadata = resolveRowBindingMetadata({
    row: input.row,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const target = rowMetadata?.target;
  const connection = input.availableConnections.find(
    (candidate) => candidate.id === input.row.connectionId,
  );
  const connectionTarget =
    connection === undefined
      ? undefined
      : input.availableTargets.find((candidate) => candidate.targetKey === connection.targetKey);
  const title =
    connection === undefined
      ? "Unknown integration"
      : (target?.displayName ?? connectionTarget?.displayName ?? "Unknown integration");

  return {
    connection,
    connectionMessage:
      connection === undefined
        ? "Connection cannot be found"
        : target === undefined
          ? "Integration no longer available."
          : null,
    logoKey: target?.logoKey ?? connectionTarget?.logoKey,
    target,
    title,
  };
}

function SandboxProfileRuntimeIntegrationRows(
  input: SandboxProfileRuntimeIntegrationRowsProps,
): React.JSX.Element {
  const controlsAreDisabled = input.disabled === true;
  const isReadOnly = input.readOnly === true;
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
  const gitRow = input.integrationRows.find((row) => row.kind === "git") ?? null;
  const gitIssue = resolveBindingIssue({
    row: gitRow,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const hasNoGitProviderOptions = gitIssue === null && gitChoices.length === 0;
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
  const gitTargetKey = findTargetForConnection({
    connectionId: gitRow?.connectionId,
    availableConnections: input.availableConnections,
  });

  async function upsertGitBinding(targetKey: string): Promise<void> {
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

    if (gitRow === null) {
      await input.onAddIntegrationBindingRow({
        kind: "git",
        connectionId: nextConnection.id,
        config: nextConfig,
      });
      return;
    }

    input.onIntegrationBindingRowChange(gitRow.clientId, {
      connectionId: nextConnection.id,
      config: nextConfig,
    });
  }

  return (
    <>
      <SandboxProfileSectionCard>
        <Field contentWidth="fill" orientation="horizontal">
          <FieldHeader>
            <FieldLabel>Agent</FieldLabel>
          </FieldHeader>
          <FieldContent>
            {agentDisplayChoice === undefined ? null : (
              <IntegrationNameCell item={agentDisplayChoice} />
            )}
          </FieldContent>
        </Field>
      </SandboxProfileSectionCard>

      <SandboxProfileSectionCard>
        <div className="grid gap-4">
          <Field contentWidth="fill" orientation="horizontal">
            <FieldHeader>
              <FieldLabel>Git Provider</FieldLabel>
            </FieldHeader>
            <FieldContent>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {hasNoGitProviderOptions ? (
                    <NoGitProvidersCell />
                  ) : gitIssue === null ? (
                    <IntegrationSelectionCell
                      allowNone={true}
                      ariaLabel="git provider integration"
                      choices={gitChoices}
                      onIntegrationChange={(nextTargetKey) => {
                        if (controlsAreDisabled) {
                          return;
                        }
                        if (nextTargetKey === NoIntegrationValue) {
                          if (gitRow !== null) {
                            input.onRemoveIntegrationBindingRow(gitRow.clientId);
                          }
                          return;
                        }
                        void upsertGitBinding(nextTargetKey);
                      }}
                      selectedIntegrationId={gitTargetKey ?? NoIntegrationValue}
                      disabled={controlsAreDisabled}
                      readOnly={isReadOnly}
                    />
                  ) : (
                    <UnresolvedNoneCell />
                  )}
                </div>
                {gitIssue === null || gitRow === null || isReadOnly ? null : (
                  <RemoveIntegrationBindingButton
                    disabled={controlsAreDisabled}
                    label="Remove git provider"
                    onRemove={() => {
                      if (controlsAreDisabled) {
                        return;
                      }

                      input.onRemoveIntegrationBindingRow(gitRow.clientId);
                    }}
                  />
                )}
              </div>
            </FieldContent>
          </Field>

          {gitRow === null ||
          !hasSandboxProfileBindingResourcesAndToolsCellContent({
            row: gitRow,
            availableConnections: input.availableConnections,
            availableTargets: input.availableTargets,
          }) ? null : (
            <SandboxProfileBindingResourcesAndToolsCell
              availableConnections={input.availableConnections}
              availableTargets={input.availableTargets}
              disabled={controlsAreDisabled}
              showGroupLabels={true}
              readOnly={isReadOnly}
              onRowChange={input.onIntegrationBindingRowChange}
              row={gitRow}
            />
          )}
        </div>
      </SandboxProfileSectionCard>
    </>
  );
}

export function SandboxProfileIntegrationsSetupSection(
  input: SandboxProfileIntegrationsSetupSectionProps,
): React.JSX.Element {
  const [isAddConnectorsDialogOpen, setIsAddConnectorsDialogOpen] = useState(false);
  const controlsAreDisabled = input.disabled === true;
  const isReadOnly = input.readOnly === true;
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
  const hasNoGitProviderOptions = gitIssue === null && gitChoices.length === 0;
  const hasUnresolvedConnectorRows = connectorRows.some(
    (row) =>
      resolveConnectorRowIssue({
        row,
        availableConnections: input.availableConnections,
        availableTargets: input.availableTargets,
      }) !== null,
  );
  const hasUnresolvedRows = agentIssue !== null || gitIssue !== null || hasUnresolvedConnectorRows;

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
  const showGitProxiedConnection =
    !hasNoGitProviderOptions && (gitIssue !== null || gitTargetKey !== null);

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
        <Notice
          dismissible
          onDismiss={input.onIntegrationSaveErrorDismiss}
          resetKey={input.integrationSaveError}
          title="Save failed"
          variant="alert"
        >
          {input.integrationSaveError}
        </Notice>
      ) : null}

      {hasUnresolvedRows && !isReadOnly ? (
        <Notice title="Some integrations need attention" variant="alert">
          Remove or replace integrations where the connection cannot be found.
        </Notice>
      ) : null}

      {input.runtimeSettings === null ? null : (
        <SectionBlock title="Runtime">
          <div className="grid gap-4">
            <SandboxProfileRuntimeIntegrationRows
              availableConnections={input.availableConnections}
              availableTargets={input.availableTargets}
              disabled={input.disabled}
              integrationRows={input.integrationRows}
              onAddIntegrationBindingRow={input.onAddIntegrationBindingRow}
              onIntegrationBindingRowChange={input.onIntegrationBindingRowChange}
              onRemoveIntegrationBindingRow={input.onRemoveIntegrationBindingRow}
              readOnly={input.readOnly}
            />
            {input.runtimeSettings}
            <SandboxProfileSectionCard>
              <div className="grid gap-3">
                {connectorRows.length === 0 ? null : (
                  <ResponsiveFieldList columns={SandboxProfileToolsColumns} gapClassName="gap-6">
                    {connectorRows.map((row) => {
                      const presentation = resolveConnectorRowPresentation({
                        row,
                        availableConnections: input.availableConnections,
                        availableTargets: input.availableTargets,
                      });
                      const hasResourcesAndTools =
                        hasSandboxProfileBindingResourcesAndToolsCellContent({
                          row,
                          availableConnections: input.availableConnections,
                          availableTargets: input.availableTargets,
                        });

                      return (
                        <ResponsiveFieldListRow
                          className={isReadOnly ? "py-4" : "py-4 pr-10 md:pr-0"}
                          gapClassName="gap-6"
                          gridClassName="md:items-start"
                          key={row.clientId}
                        >
                          <ResponsiveFieldListCell columnKey="integration">
                            {presentation.connection === undefined ? (
                              <UnresolvedIntegrationCell title={presentation.title} />
                            ) : (
                              <IntegrationNameCell
                                item={{
                                  id:
                                    presentation.target?.targetKey ??
                                    presentation.connection.targetKey ??
                                    row.clientId,
                                  hasSelectableConnections: true,
                                  kind: "connector",
                                  logoKey: presentation.logoKey,
                                  title: presentation.title,
                                }}
                              />
                            )}
                          </ResponsiveFieldListCell>
                          <ResponsiveFieldListCell
                            columnKey="resources-and-tools"
                            hideOnMobile={!hasResourcesAndTools}
                          >
                            <SandboxProfileBindingResourcesAndToolsCell
                              availableConnections={input.availableConnections}
                              availableTargets={input.availableTargets}
                              disabled={controlsAreDisabled}
                              readOnly={isReadOnly}
                              onRowChange={input.onIntegrationBindingRowChange}
                              row={row}
                            />
                          </ResponsiveFieldListCell>
                          <ResponsiveFieldListCell
                            className={SandboxProfileIntegrationActionCellClassName}
                            columnKey="actions"
                          >
                            {isReadOnly ? null : (
                              <RemoveIntegrationBindingButton
                                disabled={controlsAreDisabled}
                                label="Remove connector"
                                onRemove={() => {
                                  if (controlsAreDisabled) {
                                    return;
                                  }

                                  input.onRemoveIntegrationBindingRow(row.clientId);
                                }}
                              />
                            )}
                          </ResponsiveFieldListCell>
                        </ResponsiveFieldListRow>
                      );
                    })}
                  </ResponsiveFieldList>
                )}

                {addConnectorChoices.length === 0 || isReadOnly ? null : (
                  <Button
                    className="px-0 text-sm"
                    disabled={controlsAreDisabled}
                    onClick={() => {
                      if (controlsAreDisabled) {
                        return;
                      }

                      setIsAddConnectorsDialogOpen(true);
                    }}
                    type="button"
                    variant="link"
                  >
                    <PlusIcon aria-hidden className="size-4" />
                    Add integration or tool
                  </Button>
                )}
              </div>
            </SandboxProfileSectionCard>
          </div>
        </SectionBlock>
      )}
      <SectionBlock title="Proxied Connections">
        <SandboxProfileSectionCard>
          <ResponsiveFieldList
            columns={SandboxProfileProxiedConnectionColumns}
            gapClassName="gap-6"
          >
            <ResponsiveFieldListRow
              className="py-4"
              gapClassName="gap-6"
              gridClassName="md:items-start"
              isLastRow={!showGitProxiedConnection && connectorRows.length === 0}
            >
              <ResponsiveFieldListCell columnKey="connection">
                <RuntimeSettingLabel>Agent</RuntimeSettingLabel>
              </ResponsiveFieldListCell>
              <ResponsiveFieldListCell columnKey="account">
                <ConnectionSelectionCell
                  ariaLabel="agent harness connection"
                  availableConnections={resolveConnectionsForTarget({
                    targetKey: agentTargetKey ?? agentChoices[0]?.id ?? null,
                    availableConnections: input.availableConnections,
                  })}
                  onConnectionChange={(nextConnectionId) => {
                    if (controlsAreDisabled) {
                      return;
                    }
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
                  disabled={controlsAreDisabled}
                  readOnly={isReadOnly}
                />
              </ResponsiveFieldListCell>
              <ResponsiveFieldListCell
                className={SandboxProfileIntegrationActionCellClassName}
                columnKey="actions"
              />
            </ResponsiveFieldListRow>

            {!showGitProxiedConnection ? null : (
              <ResponsiveFieldListRow
                className={
                  gitIssue === null || gitRow === null || isReadOnly ? "py-4" : "py-4 pr-10 md:pr-0"
                }
                gapClassName="gap-6"
                gridClassName="md:items-start"
                isLastRow={connectorRows.length === 0}
              >
                <ResponsiveFieldListCell columnKey="connection">
                  <RuntimeSettingLabel>Git provider</RuntimeSettingLabel>
                </ResponsiveFieldListCell>
                <ResponsiveFieldListCell columnKey="account">
                  {gitIssue === "missing-connection" ? (
                    <UnresolvedConnectionCell message="Connection cannot be found" />
                  ) : gitIssue === "missing-target" ? (
                    <UnresolvedConnectionCell message="Integration no longer available." />
                  ) : (
                    <ConnectionSelectionCell
                      ariaLabel="git provider connection"
                      availableConnections={resolveConnectionsForTarget({
                        targetKey: gitTargetKey,
                        availableConnections: input.availableConnections,
                      })}
                      onConnectionChange={(nextConnectionId) => {
                        if (controlsAreDisabled) {
                          return;
                        }
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
                      disabled={controlsAreDisabled}
                      readOnly={isReadOnly}
                    />
                  )}
                </ResponsiveFieldListCell>
                <ResponsiveFieldListCell
                  className={SandboxProfileIntegrationActionCellClassName}
                  columnKey="actions"
                />
              </ResponsiveFieldListRow>
            )}

            {connectorRows.map((row, rowIndex) => {
              const presentation = resolveConnectorRowPresentation({
                row,
                availableConnections: input.availableConnections,
                availableTargets: input.availableTargets,
              });

              return (
                <ResponsiveFieldListRow
                  className={isReadOnly ? "py-4" : "py-4 pr-10 md:pr-0"}
                  gapClassName="gap-6"
                  gridClassName="md:items-start"
                  isLastRow={rowIndex === connectorRows.length - 1}
                  key={row.clientId}
                >
                  <ResponsiveFieldListCell columnKey="connection">
                    <RuntimeSettingLabel>{presentation.title}</RuntimeSettingLabel>
                  </ResponsiveFieldListCell>
                  <ResponsiveFieldListCell columnKey="account">
                    {presentation.connectionMessage === null &&
                    presentation.target !== undefined ? (
                      <ConnectionSelectionCell
                        ariaLabel={`${presentation.target.displayName} connection`}
                        availableConnections={resolveConnectionsForTarget({
                          targetKey: presentation.target.targetKey,
                          availableConnections: input.availableConnections,
                        })}
                        onConnectionChange={(nextConnectionId) => {
                          if (controlsAreDisabled) {
                            return;
                          }
                          updateBindingConnection(row, nextConnectionId);
                        }}
                        selectedConnectionId={row.connectionId}
                        disabled={controlsAreDisabled}
                        readOnly={isReadOnly}
                      />
                    ) : (
                      <UnresolvedConnectionCell
                        message={presentation.connectionMessage ?? "Connection cannot be found"}
                      />
                    )}
                  </ResponsiveFieldListCell>
                  <ResponsiveFieldListCell
                    className={SandboxProfileIntegrationActionCellClassName}
                    columnKey="actions"
                  />
                </ResponsiveFieldListRow>
              );
            })}
          </ResponsiveFieldList>
        </SandboxProfileSectionCard>
      </SectionBlock>

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

export function SandboxProfileIntegrationsSetupUnavailableState(input: {
  integrationBindingsError: unknown;
  integrationDirectoryError: unknown;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {input.integrationBindingsError !== null ? (
        <Notice title="Could not load integration bindings" variant="alert">
          {resolveApiErrorMessage({
            error: input.integrationBindingsError,
            fallbackMessage: "Could not load sandbox profile integration bindings.",
          })}
        </Notice>
      ) : null}
      {input.integrationDirectoryError !== null ? (
        <Notice title="Could not load integration connections" variant="alert">
          {resolveApiErrorMessage({
            error: input.integrationDirectoryError,
            fallbackMessage: "Could not load integration connections.",
          })}
        </Notice>
      ) : null}
    </div>
  );
}
