import {
  agentDefinitionAllowsRuntime,
  createBrowserDefinitionsBundle,
} from "@mistle/integrations-definitions/browser";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  FieldLabelWithTooltip,
  Notice,
  SectionBlock,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TextLink,
} from "@mistle/ui";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { IntegrationLogo } from "../integrations/integration-logo.js";
import type {
  SandboxIntegrationBindingKind,
  SandboxProfileVersion,
} from "../sandbox-profiles/sandbox-profiles-types.js";
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
  hasSelectableConnections: boolean;
  logoKey: string | undefined;
  title: string;
};

type GitConnectionChoice = {
  id: string;
  displayName: string;
  logoKey: string | undefined;
};

type SandboxProfileIntegrationsSetupSectionProps = {
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
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
  gitCommitSigningIntegrationConnectionId: string | null;
  identityLinkedGitConnectionIds: readonly string[] | null;
  onAddIntegrationBindingRow: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  onGitCommitSigningIntegrationConnectionChange: (connectionId: string | null) => void;
  onIntegrationBindingRowChange: (
    clientId: string,
    changes: Partial<Omit<SandboxProfileBindingEditorRow, "clientId">>,
  ) => void;
  onRemoveIntegrationBindingRow: (clientId: string) => void;
  onIntegrationSaveErrorDismiss: () => void;
  runtimeSettings: React.ReactNode | null;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  agentRuntimeConnectionErrorMessage?: string | null | undefined;
};

const NoGitConnectionValue = "none";
const NoProxiedConnectionValue = "none";
const Definitions = createBrowserDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;
const GitCommitSigningTooltip =
  "Commits made in sandboxes will be signed with the acting user's linked GitHub account when enabled.";
const GitCommitSigningIdentityLinkingDisabledMessage = "Requires identity linking";
const OrganizationIdentityLinkingSettingsPath = "/settings/organization/identity-linking";
const SandboxProfileIntegrationConnectionColumns = [
  { key: "integration", label: "Integration", desktopWidth: "minmax(8rem,0.55fr)" },
  {
    key: "proxied-connection",
    label: "Proxied Connection",
    desktopWidth: "minmax(0,1fr)",
  },
  {
    key: "resources-and-tools",
    label: "Resources & Tools",
    desktopWidth: "minmax(0,1fr)",
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

const SandboxProfileIntegrationCellContentClassName =
  "flex items-center @3xl/responsive-field-list:min-h-9";
const SandboxProfileIntegrationActionCellClassName =
  "absolute right-0 top-0 @3xl/responsive-field-list:static @3xl/responsive-field-list:flex @3xl/responsive-field-list:min-h-9 @3xl/responsive-field-list:items-center @3xl/responsive-field-list:justify-end";

function IntegrationNameCell(input: {
  logoKey: string | undefined;
  title: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={`${SandboxProfileIntegrationCellContentClassName} gap-2 text-sm`}>
      {input.logoKey === undefined ? null : (
        <IntegrationLogo alt="" className="h-5 w-5 rounded-sm" logoKey={input.logoKey} />
      )}
      <div className="min-w-0 truncate font-medium">{input.title}</div>
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

function ConnectionSelectionCell(input: {
  ariaLabel: string;
  availableConnections: readonly IntegrationConnectionSummary[];
  selectedConnectionId: string | undefined;
  onConnectionChange: (nextConnectionId: string) => void;
  allowNone?: boolean;
  disabled?: boolean | undefined;
  errorMessage?: string | null | undefined;
  invalid?: boolean | undefined;
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
    <div className="grid gap-1.5">
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
        <SelectTrigger
          aria-invalid={input.invalid === true ? true : undefined}
          aria-label={input.ariaLabel}
          className="w-full min-w-0"
        >
          <SelectValue placeholder="Choose a connection">
            {selectedConnection === undefined ? (
              "Choose a connection"
            ) : (
              <ConnectionNameCell displayName={selectedConnection.displayName} />
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {input.allowNone === true ? (
            <SelectItem value={NoProxiedConnectionValue}>None</SelectItem>
          ) : null}
          {input.availableConnections.map((connection) => (
            <SelectItem key={connection.id} value={connection.id}>
              {connection.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {input.invalid === true && input.errorMessage !== null && input.errorMessage !== undefined ? (
        <p className="text-destructive text-xs">{input.errorMessage}</p>
      ) : null}
    </div>
  );
}

function GitConnectionSelectionCell(input: {
  ariaLabel: string;
  choices: readonly GitConnectionChoice[];
  selectedConnectionId: string | undefined;
  onConnectionChange: (nextConnectionId: string) => void;
  onNone: () => void;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
}): React.JSX.Element {
  const selectedChoice = input.choices.find((choice) => choice.id === input.selectedConnectionId);

  if (input.readOnly === true) {
    return selectedChoice === undefined ? (
      <div className={SandboxProfileIntegrationCellContentClassName}>
        <p className="text-sm">None</p>
      </div>
    ) : (
      <IntegrationNameCell logoKey={selectedChoice.logoKey} title={selectedChoice.displayName} />
    );
  }

  return (
    <Select
      disabled={input.disabled === true}
      onValueChange={(nextConnectionId) => {
        if (nextConnectionId === null) {
          return;
        }
        if (nextConnectionId === NoGitConnectionValue) {
          input.onNone();
          return;
        }
        input.onConnectionChange(nextConnectionId);
      }}
      value={input.selectedConnectionId ?? NoGitConnectionValue}
    >
      <SelectTrigger aria-label={input.ariaLabel} className="w-full min-w-0">
        <SelectValue placeholder="Choose a git connection">
          {selectedChoice === undefined ? (
            "None"
          ) : (
            <IntegrationNameCell
              logoKey={selectedChoice.logoKey}
              title={selectedChoice.displayName}
            />
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NoGitConnectionValue}>None</SelectItem>
        {input.choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            <div className="flex items-center gap-2">
              {choice.logoKey === undefined ? null : (
                <IntegrationLogo alt="" className="h-5 w-5 rounded-sm" logoKey={choice.logoKey} />
              )}
              <span>{choice.displayName}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GitCommitSigningSwitchField(input: {
  checked: boolean;
  disabled: boolean;
  disabledMessage: string | null;
  onCheckedChange: (checked: boolean) => void;
  readOnly: boolean;
}): React.JSX.Element {
  if (input.readOnly) {
    return (
      <Field contentWidth="fill" orientation="horizontal">
        <FieldHeader>
          <FieldLabelWithTooltip
            tooltip={GitCommitSigningTooltip}
            tooltipLabel="About Git commit signing"
          >
            Sign Git commits
          </FieldLabelWithTooltip>
        </FieldHeader>
        <FieldContent>
          <div className={SandboxProfileIntegrationCellContentClassName}>
            <p className="text-sm">{input.checked ? "Yes" : "No"}</p>
          </div>
        </FieldContent>
      </Field>
    );
  }

  return (
    <Field contentWidth="fill" orientation="horizontal">
      <FieldHeader>
        <FieldLabelWithTooltip
          htmlFor="sandbox-profile-git-commit-signing"
          tooltip={GitCommitSigningTooltip}
          tooltipLabel="About Git commit signing"
        >
          Sign Git commits
        </FieldLabelWithTooltip>
      </FieldHeader>
      <FieldContent>
        <div className="flex min-h-10 items-center gap-3">
          <Switch
            checked={input.checked}
            disabled={input.disabled}
            id="sandbox-profile-git-commit-signing"
            onCheckedChange={input.onCheckedChange}
          />
          {input.disabledMessage === null ? null : (
            <p className="text-muted-foreground text-sm leading-none">
              {input.disabledMessage === GitCommitSigningIdentityLinkingDisabledMessage ? (
                <>
                  <TextLink render={<RouterLink to={OrganizationIdentityLinkingSettingsPath} />}>
                    Configure
                  </TextLink>{" "}
                  identity linking to enable
                </>
              ) : (
                input.disabledMessage
              )}
            </p>
          )}
        </div>
      </FieldContent>
    </Field>
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
      className="h-9 w-8"
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
  agentRuntimeId?: SandboxProfileVersion["agentRuntimeId"];
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

    if (
      input.kind === "agent" &&
      input.agentRuntimeId !== undefined &&
      !targetAllowsAgentRuntime({
        target,
        agentRuntimeId: input.agentRuntimeId,
      })
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
      logoKey: target.logoKey,
      title: target.displayName,
    });
  }

  return choices;
}

function targetAllowsAgentRuntime(input: {
  target: IntegrationTargetSummary;
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
}): boolean {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.target.familyId,
    variantId: input.target.variantId,
  });

  return agentDefinitionAllowsRuntime({
    definition,
    runtimeId: input.agentRuntimeId,
  });
}

function resolveAgentBindingRowsForRuntime(input: {
  agentRows: readonly SandboxProfileBindingEditorRow[];
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  agentRuntimeId: SandboxProfileVersion["agentRuntimeId"];
}): {
  rowsByTargetKey: ReadonlyMap<string, SandboxProfileBindingEditorRow>;
  staleRows: readonly SandboxProfileBindingEditorRow[];
  runtimeIncompatibleRows: readonly SandboxProfileBindingEditorRow[];
} {
  const rowsByTargetKey = new Map<string, SandboxProfileBindingEditorRow>();
  const staleRows: SandboxProfileBindingEditorRow[] = [];
  const runtimeIncompatibleRows: SandboxProfileBindingEditorRow[] = [];

  for (const row of input.agentRows) {
    const metadata = resolveRowBindingMetadata({
      row,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
    });
    if (metadata === null || metadata.target === undefined) {
      staleRows.push(row);
      continue;
    }

    if (
      !targetAllowsAgentRuntime({
        target: metadata.target,
        agentRuntimeId: input.agentRuntimeId,
      })
    ) {
      runtimeIncompatibleRows.push(row);
      continue;
    }

    rowsByTargetKey.set(metadata.target.targetKey, row);
  }

  return {
    rowsByTargetKey,
    staleRows,
    runtimeIncompatibleRows,
  };
}

function resolveConnectionsForTarget(
  targetKey: string | null,
  availableConnections: readonly IntegrationConnectionSummary[],
): IntegrationConnectionSummary[] {
  if (targetKey === null) {
    return [];
  }

  return availableConnections.filter((connection) => connection.targetKey === targetKey);
}

function resolveGitConnectionChoices(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): GitConnectionChoice[] {
  const choices: GitConnectionChoice[] = [];

  for (const connection of input.availableConnections) {
    const target = input.availableTargets.find(
      (candidate) => candidate.targetKey === connection.targetKey,
    );
    if (target === undefined || resolveBindingKindFromTarget(target) !== "git") {
      continue;
    }

    choices.push({
      id: connection.id,
      displayName: `${target.displayName} - ${connection.displayName}`,
      logoKey: target.logoKey,
    });
  }

  return choices;
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
          <IntegrationLogo alt="" logoKey={input.choice.logoKey} />
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
    agentRuntimeId: input.agentRuntimeId,
  });
  const gitConnectionChoices = resolveGitConnectionChoices({
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const connectorChoices = resolveKindChoices({
    kind: "connector",
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
    includeDisconnectedTargets: true,
  });

  const agentRows = useMemo(
    () => input.integrationRows.filter((row) => row.kind === "agent"),
    [input.integrationRows],
  );
  const gitRow = input.integrationRows.find((row) => row.kind === "git") ?? null;
  const connectorRows = input.integrationRows.filter((row) => row.kind === "connector");
  const agentRowResolution = useMemo(
    () =>
      resolveAgentBindingRowsForRuntime({
        agentRows,
        availableConnections: input.availableConnections,
        availableTargets: input.availableTargets,
        agentRuntimeId: input.agentRuntimeId,
      }),
    [agentRows, input.agentRuntimeId, input.availableConnections, input.availableTargets],
  );
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
  const agentIssues = agentRows.map((row) =>
    resolveBindingIssue({
      row,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
    }),
  );
  const gitIssue = resolveBindingIssue({
    row: gitRow,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const selectedGitConnectionIsIdentityLinked =
    gitRow !== null && input.identityLinkedGitConnectionIds?.includes(gitRow.connectionId) === true;
  const gitCommitSigningIsChecked =
    gitRow !== null && input.gitCommitSigningIntegrationConnectionId === gitRow.connectionId;
  const gitCommitSigningDisabledMessage =
    gitRow === null
      ? "Select a Git connection"
      : input.identityLinkedGitConnectionIds === null
        ? "Loading identity linking"
        : selectedGitConnectionIsIdentityLinked
          ? null
          : GitCommitSigningIdentityLinkingDisabledMessage;
  const gitCommitSigningIsDisabled =
    controlsAreDisabled ||
    gitRow === null ||
    input.identityLinkedGitConnectionIds === null ||
    !selectedGitConnectionIsIdentityLinked;
  const hasUnresolvedConnectorRows = connectorRows.some(
    (row) =>
      resolveBindingIssue({
        row,
        availableConnections: input.availableConnections,
        availableTargets: input.availableTargets,
      }) !== null,
  );
  const hasUnresolvedAgentRows = agentIssues.some((issue) => issue !== null);
  const hasUnresolvedRows =
    hasUnresolvedAgentRows || gitIssue !== null || hasUnresolvedConnectorRows;

  useEffect(() => {
    if (controlsAreDisabled || isReadOnly) {
      return;
    }

    for (const row of agentRowResolution.runtimeIncompatibleRows) {
      input.onRemoveIntegrationBindingRow(row.clientId);
    }
  }, [
    agentRowResolution.runtimeIncompatibleRows,
    controlsAreDisabled,
    input.onRemoveIntegrationBindingRow,
    isReadOnly,
  ]);

  async function saveBindingConnection(
    kind: SandboxIntegrationBindingKind,
    row: SandboxProfileBindingEditorRow | null,
    nextConnectionId: string,
  ): Promise<void> {
    const nextConfig = buildDefaultConfig({
      connectionId: nextConnectionId,
      availableConnections: input.availableConnections,
      availableTargets: input.availableTargets,
    });
    if (nextConfig === null) {
      return;
    }

    if (row === null) {
      const didSave = await input.onAddIntegrationBindingRow({
        kind,
        connectionId: nextConnectionId,
        config: nextConfig,
      });
      if (
        didSave &&
        kind === "git" &&
        input.gitCommitSigningIntegrationConnectionId !== null &&
        input.identityLinkedGitConnectionIds?.includes(nextConnectionId) === true
      ) {
        input.onGitCommitSigningIntegrationConnectionChange(nextConnectionId);
      }
      return;
    }

    const previousConnectionId = row.connectionId;
    input.onIntegrationBindingRowChange(row.clientId, {
      connectionId: nextConnectionId,
      config: nextConfig,
    });
    if (kind === "git" && input.gitCommitSigningIntegrationConnectionId === previousConnectionId) {
      if (input.identityLinkedGitConnectionIds === null) {
        input.onGitCommitSigningIntegrationConnectionChange(null);
        return;
      }

      input.onGitCommitSigningIntegrationConnectionChange(
        input.identityLinkedGitConnectionIds.includes(nextConnectionId) ? nextConnectionId : null,
      );
    }
  }

  async function addConnector(targetKey: string): Promise<void> {
    const connections = resolveConnectionsForTarget(targetKey, input.availableConnections);
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

  const addConnectorActionIsDisabled = controlsAreDisabled || addConnectorChoices.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <IntegrationLoadErrorNotice
        integrationBindingsError={
          input.integrationBindingsQuery.isError ? input.integrationBindingsQuery.error : null
        }
        integrationDirectoryError={
          input.integrationDirectoryQuery.isError ? input.integrationDirectoryQuery.error : null
        }
      />

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
            {input.runtimeSettings}
            <SandboxProfileSectionCard>
              <div className="grid gap-4">
                <Field contentWidth="fill" orientation="horizontal">
                  <FieldHeader>
                    <FieldLabel>Git Connection</FieldLabel>
                  </FieldHeader>
                  <FieldContent>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        {gitIssue === null ? (
                          <GitConnectionSelectionCell
                            ariaLabel="git connection"
                            choices={gitConnectionChoices}
                            onConnectionChange={(nextConnectionId) => {
                              if (controlsAreDisabled) {
                                return;
                              }
                              void saveBindingConnection("git", gitRow, nextConnectionId);
                            }}
                            onNone={() => {
                              if (controlsAreDisabled || gitRow === null) {
                                return;
                              }
                              if (
                                input.gitCommitSigningIntegrationConnectionId ===
                                gitRow.connectionId
                              ) {
                                input.onGitCommitSigningIntegrationConnectionChange(null);
                              }
                              input.onRemoveIntegrationBindingRow(gitRow.clientId);
                            }}
                            selectedConnectionId={gitRow?.connectionId}
                            disabled={controlsAreDisabled}
                            readOnly={isReadOnly}
                          />
                        ) : gitIssue === "missing-connection" ? (
                          <UnresolvedConnectionCell message="Connection cannot be found" />
                        ) : (
                          <UnresolvedConnectionCell message="Integration no longer available." />
                        )}
                      </div>
                      {gitIssue === null || gitRow === null || isReadOnly ? null : (
                        <RemoveIntegrationBindingButton
                          disabled={controlsAreDisabled}
                          label="Remove git connection"
                          onRemove={() => {
                            if (controlsAreDisabled) {
                              return;
                            }
                            if (
                              input.gitCommitSigningIntegrationConnectionId === gitRow.connectionId
                            ) {
                              input.onGitCommitSigningIntegrationConnectionChange(null);
                            }

                            input.onRemoveIntegrationBindingRow(gitRow.clientId);
                          }}
                        />
                      )}
                    </div>
                  </FieldContent>
                </Field>

                {gitRow === null ? null : (
                  <GitCommitSigningSwitchField
                    checked={gitCommitSigningIsChecked}
                    disabled={gitCommitSigningIsDisabled}
                    disabledMessage={gitCommitSigningDisabledMessage}
                    onCheckedChange={(checked) => {
                      if (gitCommitSigningIsDisabled) {
                        return;
                      }
                      input.onGitCommitSigningIntegrationConnectionChange(
                        checked ? gitRow.connectionId : null,
                      );
                    }}
                    readOnly={isReadOnly}
                  />
                )}

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
            <SandboxProfileSectionCard>
              <div className="grid gap-3">
                <ResponsiveFieldList
                  columns={SandboxProfileIntegrationConnectionColumns}
                  gapClassName="gap-6"
                >
                  {agentRowResolution.staleRows.length === 0 && agentChoices.length === 0 ? (
                    <ResponsiveFieldListRow
                      className="py-4"
                      gapClassName="gap-6"
                      gridClassName="@3xl/responsive-field-list:items-start"
                      isLastRow={connectorRows.length === 0}
                    >
                      <ResponsiveFieldListCell columnKey="integration">
                        <div
                          className={`${SandboxProfileIntegrationCellContentClassName} text-sm font-medium`}
                        >
                          Model provider
                        </div>
                      </ResponsiveFieldListCell>
                      <ResponsiveFieldListCell columnKey="proxied-connection">
                        <div className={SandboxProfileIntegrationCellContentClassName}>
                          <p className="text-muted-foreground text-sm">No providers configured.</p>
                        </div>
                      </ResponsiveFieldListCell>
                      <ResponsiveFieldListCell columnKey="resources-and-tools" hideOnMobile>
                        <div
                          aria-hidden
                          className={SandboxProfileIntegrationCellContentClassName}
                        />
                      </ResponsiveFieldListCell>
                      <ResponsiveFieldListCell
                        className={SandboxProfileIntegrationActionCellClassName}
                        columnKey="actions"
                      />
                    </ResponsiveFieldListRow>
                  ) : null}

                  {agentRowResolution.staleRows.map((row) => {
                    const agentIssue = resolveBindingIssue({
                      row,
                      availableConnections: input.availableConnections,
                      availableTargets: input.availableTargets,
                    });

                    return (
                      <ResponsiveFieldListRow
                        className={
                          isReadOnly ? "py-4" : "py-4 pr-10 @3xl/responsive-field-list:pr-0"
                        }
                        gapClassName="gap-6"
                        gridClassName="@3xl/responsive-field-list:items-start"
                        key={row.clientId}
                      >
                        <ResponsiveFieldListCell columnKey="integration">
                          <div
                            className={`${SandboxProfileIntegrationCellContentClassName} text-sm font-medium`}
                          >
                            Agent runtime connection
                          </div>
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell columnKey="proxied-connection">
                          <UnresolvedConnectionCell
                            message={
                              agentIssue === "missing-target"
                                ? "Integration no longer available."
                                : "Connection cannot be found"
                            }
                          />
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell columnKey="resources-and-tools" hideOnMobile>
                          <div
                            aria-hidden
                            className={SandboxProfileIntegrationCellContentClassName}
                          />
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell
                          className={SandboxProfileIntegrationActionCellClassName}
                          columnKey="actions"
                        >
                          {isReadOnly ? null : (
                            <RemoveIntegrationBindingButton
                              disabled={controlsAreDisabled}
                              label="Remove agent runtime connection"
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

                  {agentChoices.map((choice, choiceIndex) => {
                    const agentRow = agentRowResolution.rowsByTargetKey.get(choice.id) ?? null;

                    return (
                      <ResponsiveFieldListRow
                        className="py-4"
                        gapClassName="gap-6"
                        gridClassName="@3xl/responsive-field-list:items-start"
                        isLastRow={
                          choiceIndex === agentChoices.length - 1 && connectorRows.length === 0
                        }
                        key={choice.id}
                      >
                        <ResponsiveFieldListCell columnKey="integration">
                          <IntegrationNameCell logoKey={choice.logoKey} title={choice.title} />
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell columnKey="proxied-connection">
                          <ConnectionSelectionCell
                            allowNone={true}
                            ariaLabel={`${choice.title} connection`}
                            availableConnections={resolveConnectionsForTarget(
                              choice.id,
                              input.availableConnections,
                            )}
                            onConnectionChange={(nextConnectionId) => {
                              if (controlsAreDisabled) {
                                return;
                              }
                              if (nextConnectionId === NoProxiedConnectionValue) {
                                if (agentRow !== null) {
                                  input.onRemoveIntegrationBindingRow(agentRow.clientId);
                                }
                                return;
                              }
                              void saveBindingConnection("agent", agentRow, nextConnectionId);
                            }}
                            selectedConnectionId={agentRow?.connectionId}
                            disabled={controlsAreDisabled}
                            errorMessage={input.agentRuntimeConnectionErrorMessage}
                            invalid={
                              input.agentRuntimeConnectionErrorMessage !== null &&
                              input.agentRuntimeConnectionErrorMessage !== undefined
                            }
                            readOnly={isReadOnly}
                          />
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell columnKey="resources-and-tools" hideOnMobile>
                          <div
                            aria-hidden
                            className={SandboxProfileIntegrationCellContentClassName}
                          />
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell
                          className={SandboxProfileIntegrationActionCellClassName}
                          columnKey="actions"
                        />
                      </ResponsiveFieldListRow>
                    );
                  })}

                  {connectorRows.map((row, rowIndex) => {
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
                        className={
                          isReadOnly ? "py-4" : "py-4 pr-10 @3xl/responsive-field-list:pr-0"
                        }
                        gapClassName="gap-6"
                        gridClassName="@3xl/responsive-field-list:items-start"
                        isLastRow={rowIndex === connectorRows.length - 1}
                        key={row.clientId}
                      >
                        <ResponsiveFieldListCell columnKey="integration">
                          {presentation.connection === undefined ? (
                            <UnresolvedIntegrationCell title={presentation.title} />
                          ) : (
                            <IntegrationNameCell
                              logoKey={presentation.logoKey}
                              title={presentation.title}
                            />
                          )}
                        </ResponsiveFieldListCell>
                        <ResponsiveFieldListCell columnKey="proxied-connection">
                          {presentation.connectionMessage === null &&
                          presentation.target !== undefined ? (
                            <ConnectionSelectionCell
                              ariaLabel={`${presentation.target.displayName} connection`}
                              availableConnections={resolveConnectionsForTarget(
                                presentation.target.targetKey,
                                input.availableConnections,
                              )}
                              onConnectionChange={(nextConnectionId) => {
                                if (controlsAreDisabled) {
                                  return;
                                }
                                void saveBindingConnection("connector", row, nextConnectionId);
                              }}
                              selectedConnectionId={row.connectionId}
                              disabled={controlsAreDisabled}
                              readOnly={isReadOnly}
                            />
                          ) : (
                            <UnresolvedConnectionCell
                              message={
                                presentation.connectionMessage ?? "Connection cannot be found"
                              }
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

                {isReadOnly ? null : (
                  <Button
                    className="px-0 text-sm"
                    disabled={addConnectorActionIsDisabled}
                    onClick={() => {
                      if (addConnectorActionIsDisabled) {
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
      <IntegrationLoadErrorNotice
        integrationBindingsError={input.integrationBindingsError}
        integrationDirectoryError={input.integrationDirectoryError}
      />
    </div>
  );
}

function IntegrationLoadErrorNotice(input: {
  integrationBindingsError: unknown;
  integrationDirectoryError: unknown;
}): React.JSX.Element | null {
  const bindingsMessage =
    input.integrationBindingsError === null
      ? null
      : resolveApiErrorMessage({
          error: input.integrationBindingsError,
          fallbackMessage: "Could not load sandbox profile integration bindings.",
        });
  const directoryMessage =
    input.integrationDirectoryError === null
      ? null
      : resolveApiErrorMessage({
          error: input.integrationDirectoryError,
          fallbackMessage: "Could not load integration connections.",
        });

  if (bindingsMessage !== null && directoryMessage !== null) {
    return (
      <Notice title="Could not load runtime and connections" variant="alert">
        <div className="space-y-1">
          <p>{bindingsMessage}</p>
          <p>{directoryMessage}</p>
        </div>
      </Notice>
    );
  }

  if (bindingsMessage !== null) {
    return (
      <Notice title="Could not load integration bindings" variant="alert">
        {bindingsMessage}
      </Notice>
    );
  }

  if (directoryMessage !== null) {
    return (
      <Notice title="Could not load integration connections" variant="alert">
        {directoryMessage}
      </Notice>
    );
  }

  return null;
}
