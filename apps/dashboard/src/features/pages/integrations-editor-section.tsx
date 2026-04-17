import { Notice } from "@mistle/ui";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
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
  resolveSelectedConnectionDisplayName: (row: SandboxProfileBindingEditorRow) => string | undefined;
  onAddIntegrationBindingRow: (input: {
    kind: SandboxIntegrationBindingKind;
    connectionId: string;
    config: Record<string, unknown>;
  }) => Promise<boolean>;
  isSubmittingIntegrationBindings: boolean;
};

const BindingSectionKinds: readonly SandboxIntegrationBindingKind[] = ["agent", "git", "connector"];

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

  return (
    <div className="gap-4 flex flex-col">
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
        <SandboxProfileBindingSection
          addDisabled={
            props.integrationDirectoryQuery.isPending ||
            availableConnectionsByKind[kind].length === 0 ||
            (kind === "agent" && integrationRowsByKind.agent.length > 0)
          }
          availableConnections={props.availableConnections}
          availableTargets={props.availableTargets}
          key={kind}
          kind={kind}
          onAdd={() => {
            openAddDialog(kind);
          }}
          onEdit={openEditDialog}
          onRowChange={props.onIntegrationBindingRowChange}
          onRemove={props.onRemoveIntegrationBindingRow}
          rowErrorsByClientId={props.integrationRowErrorsByClientId}
          rows={integrationRowsByKind[kind]}
        />
      ))}

      <SandboxProfileBindingDialog
        availableConnections={props.availableConnections}
        availableConnectionsByKind={availableConnectionsByKind}
        availableTargets={props.availableTargets}
        isSubmittingIntegrationBindings={props.isSubmittingIntegrationBindings}
        onClose={closeIntegrationDialog}
        onConnectionIdChange={updateDialogConnectionId}
        onRowChange={updateDialogRow}
        onSave={saveBindingFromDialog}
        resolveSelectedConnectionDisplayName={props.resolveSelectedConnectionDisplayName}
        state={integrationDialogState}
      />
    </div>
  );
}
