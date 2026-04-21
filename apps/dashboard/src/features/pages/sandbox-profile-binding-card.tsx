import { Button, DetailLabel, Notice } from "@mistle/ui";
import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";

import { formatConnectionDisplayName } from "../integrations/format-connection-display-name.js";
import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";
import { resolveBindingConfigSummaryItems } from "./sandbox-profile-binding-config-editor.js";
import { resolveRowBindingMetadata } from "./sandbox-profile-binding-shared.js";

const DefaultSummaryItemCount = 2;

function shouldRenderAllSummaryItems(kind: SandboxProfileBindingEditorRow["kind"]): boolean {
  return kind === "agent" || kind === "git";
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
  const summaryItems = resolveBindingConfigSummaryItems({
    row: input.row,
    connections: input.availableConnections,
    targets: input.availableTargets,
    maxItems: shouldRenderAllSummaryItems(input.row.kind)
      ? Number.POSITIVE_INFINITY
      : DefaultSummaryItemCount,
  });
  const connectionDisplayName =
    rowMetadata === null
      ? undefined
      : formatConnectionDisplayName({
          connection: rowMetadata.connection,
        });

  return (
    <div className="flex flex-col gap-3 py-2">
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
        <div className="flex gap-1">
          <Button
            aria-label="Edit binding"
            className="h-7 w-7"
            onClick={input.onEdit}
            type="button"
            variant="ghost"
          >
            <PencilSimpleIcon aria-hidden className="size-4" />
          </Button>
          <Button
            aria-label="Remove binding"
            className="h-7 w-7"
            onClick={input.onRemove}
            type="button"
            variant="ghost"
          >
            <TrashIcon aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      {summaryItems.length > 0 ? (
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {summaryItems.map((item) => (
            <div className="gap-1 flex flex-col" key={item.label}>
              <DetailLabel>{item.label}</DetailLabel>
              <dd className="text-sm">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {input.errorMessage === undefined ? null : (
        <Notice variant="alert">{input.errorMessage}</Notice>
      )}
    </div>
  );
}
