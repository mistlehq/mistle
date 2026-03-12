import { Button } from "@mistle/ui";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";

import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { formatSandboxProfileBindingSummaryItems } from "./sandbox-profile-binding-summary.js";

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

export function SandboxProfileBindingCard(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
  errorMessage?: string | undefined;
  onEdit: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const rowMetadata = resolveRowBindingMetadata({
    row: input.row,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const target = rowMetadata?.target;
  const summaryItems = formatSandboxProfileBindingSummaryItems({
    row: input.row,
    availableConnections: input.availableConnections,
    availableTargets: input.availableTargets,
  });
  const connectionDisplayName =
    rowMetadata === null
      ? undefined
      : formatConnectionDisplayName({
          connection: rowMetadata.connection,
        });

  return (
    <div className="gap-4 rounded-md border p-4 flex flex-col">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex items-center gap-2">
          {target?.logoKey ? (
            <img
              alt={`${target.displayName} logo`}
              className="h-5 w-5 rounded-sm"
              src={resolveIntegrationLogoPath({ logoKey: target.logoKey })}
            />
          ) : (
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold">
              {(target?.displayName ?? "I").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 gap-0.5 flex flex-col">
            <p className="truncate text-sm font-medium">{target?.displayName ?? "Integration"}</p>
            {connectionDisplayName === undefined ? null : (
              <p className="text-muted-foreground truncate text-xs">{connectionDisplayName}</p>
            )}
          </div>
        </div>
        <div className="gap-2 flex">
          <Button
            aria-label="Edit binding"
            onClick={input.onEdit}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <PencilSimpleIcon aria-hidden className="size-4" />
          </Button>
          <Button
            aria-label="Remove binding"
            onClick={input.onRemove}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <TrashIcon aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {summaryItems.map((item) => (
          <div className="gap-1 flex flex-col" key={item.label}>
            <dt className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {item.label}
            </dt>
            <dd className="text-sm">{item.value}</dd>
          </div>
        ))}
      </dl>

      {input.errorMessage === undefined ? null : (
        <p className="text-destructive text-sm">{input.errorMessage}</p>
      )}
    </div>
  );
}
