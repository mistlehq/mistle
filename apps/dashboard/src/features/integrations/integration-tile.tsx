import { Button } from "@mistle/ui";

import { resolveIntegrationLogoPath } from "./logo.js";

type IntegrationTileProps = {
  actionLabel: string;
  actionVariant?: "default" | "outline";
  description: string;
  displayName: string;
  familyId: string;
  statusBadge?: string;
  onAction: () => void;
};

export function IntegrationTile(props: IntegrationTileProps) {
  const statusBadgeClassName =
    props.statusBadge === "Invalid config"
      ? "border border-destructive/30 bg-destructive/10 text-destructive"
      : "border";

  return (
    <div className="border rounded-md p-3 gap-3 flex flex-col sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 gap-1 flex flex-col">
        <div className="items-center gap-2 flex">
          <IntegrationNameBadge displayName={props.displayName} familyId={props.familyId} />
          <p className="text-sm font-medium">{props.displayName}</p>
          {props.statusBadge === undefined ? null : (
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadgeClassName}`}
            >
              {props.statusBadge}
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs">{props.description}</p>
      </div>
      <div className="gap-2 flex justify-end sm:justify-start">
        <Button onClick={props.onAction} type="button" variant={props.actionVariant}>
          {props.actionLabel}
        </Button>
      </div>
    </div>
  );
}

function IntegrationNameBadge(input: { familyId: string; displayName: string }) {
  const normalizedFamilyId = input.familyId.trim().toLowerCase();
  if (normalizedFamilyId === "openai" || normalizedFamilyId === "github") {
    return (
      <img
        alt={`${input.displayName} logo`}
        className="h-5 w-5 rounded-sm"
        src={resolveIntegrationLogoPath({ logoKey: normalizedFamilyId })}
      />
    );
  }

  const firstCharacter = input.displayName.slice(0, 1).toUpperCase();
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-sm bg-muted text-muted-foreground text-[10px] font-semibold">
      {firstCharacter}
    </span>
  );
}
