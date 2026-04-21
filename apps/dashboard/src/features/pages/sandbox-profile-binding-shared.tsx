import { DetailLabel } from "@mistle/ui";
import * as React from "react";

import { IntegrationConnectionSelect } from "./integration-connection-select.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

export function resolveRowBindingMetadata(input: {
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

export function BindingConnectionField(input: {
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  selectedConnectionId: string | null;
  onValueChange: (nextConnectionId: string) => void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  id?: string;
  trailingAction?: React.ReactNode;
}): React.JSX.Element {
  const field = (
    <div className="min-w-0 flex-1 flex flex-col gap-1.5">
      <DetailLabel as="p">Connection</DetailLabel>
      <IntegrationConnectionSelect
        ariaLabel={input.ariaLabel}
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        {...(input.id === undefined ? {} : { id: input.id })}
        {...(input.disabled === undefined ? {} : { disabled: input.disabled })}
        onValueChange={input.onValueChange}
        placeholder={input.placeholder}
        selectedConnectionId={input.selectedConnectionId}
      />
    </div>
  );

  if (input.trailingAction === undefined) {
    return field;
  }

  return (
    <div className="flex items-start justify-between gap-4">
      {field}
      {input.trailingAction}
    </div>
  );
}
