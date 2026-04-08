import { Button, SectionHeader, Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
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
  const addConstraintMessage =
    input.rows.length > 0 && input.addDisabled ? formatBindingSectionConstraint(input.kind) : null;
  const addButton = (
    <Button disabled={input.addDisabled} onClick={input.onAdd} type="button" variant="outline">
      <PlusIcon />
      Add
    </Button>
  );

  return (
    <div className="gap-3 flex flex-col">
      <SectionHeader
        action={
          addConstraintMessage === null ? (
            addButton
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>{addButton}</TooltipTrigger>
              <TooltipContent side="top">{addConstraintMessage}</TooltipContent>
            </Tooltip>
          )
        }
        title={formatBindingSectionTitle(input.kind)}
      />

      {input.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {formatBindingSectionEmptyState(input.kind)}
        </p>
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
