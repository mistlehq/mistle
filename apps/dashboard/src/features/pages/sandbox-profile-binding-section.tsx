import { Button, SectionHeader } from "@mistle/ui";
import { PlusIcon } from "@phosphor-icons/react";

import type { SandboxIntegrationBindingKind } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfileBindingCard } from "./sandbox-profile-binding-card.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

function formatBindingSectionTitle(kind: SandboxIntegrationBindingKind): string {
  if (kind === "agent") {
    return "Agent Bindings";
  }
  if (kind === "git") {
    return "Git Bindings";
  }
  return "Connector Bindings";
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
  onRemove: (clientId: string) => void;
}): React.JSX.Element {
  return (
    <div className="gap-3 flex flex-col">
      <SectionHeader
        action={
          <Button
            disabled={input.addDisabled}
            onClick={input.onAdd}
            type="button"
            variant="outline"
          >
            <PlusIcon />
            Add
          </Button>
        }
        title={formatBindingSectionTitle(input.kind)}
      />

      {input.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">No bindings configured.</p>
      ) : null}

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
}
