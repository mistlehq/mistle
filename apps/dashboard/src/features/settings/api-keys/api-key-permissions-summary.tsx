import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@mistle/ui";
import { CheckIcon, EyeIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import {
  createAllowedMistleResourceAccessSummary,
  type AllowedMistleResourceGroup,
} from "./api-key-permissions.js";
import type { ApiKey } from "./api-keys-service.js";

export function ApiKeyMistleResourceAccessSummary(input: {
  apiKey: ApiKey;
  description: ReactNode;
}): React.JSX.Element {
  const [detailsAreOpen, setDetailsAreOpen] = useState(false);
  const { resourceGroups, ungroupedPermissions } = createAllowedMistleResourceAccessSummary(
    input.apiKey.permissions,
  );
  const resourceCount = resourceGroups.length;
  const resourceCountLabel =
    resourceCount === 1 ? "1 resource" : `${String(resourceCount)} resources`;
  const ungroupedPermissionCount = ungroupedPermissions.length;
  const summaryLabel =
    ungroupedPermissionCount === 0
      ? resourceCountLabel
      : `${resourceCountLabel}, ${formatPermissionCount(ungroupedPermissionCount)}`;

  return (
    <>
      <Button
        aria-label={`View allowed Mistle resources: ${summaryLabel}`}
        className="text-muted-foreground"
        onClick={() => {
          setDetailsAreOpen(true);
        }}
        size="sm"
        title="View allowed Mistle resources"
        type="button"
        variant="ghost"
      >
        <span>{summaryLabel}</span>
        <EyeIcon aria-hidden />
      </Button>
      <Dialog onOpenChange={setDetailsAreOpen} open={detailsAreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allowed Mistle resources</DialogTitle>
            <DialogDescription>{input.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {resourceGroups.map((group) => (
              <MistleResourceAccessGroup group={group} key={group.label} />
            ))}
            {ungroupedPermissions.length === 0 ? null : (
              <MistleResourceAccessGroup
                group={{
                  label: "Other permissions",
                  actions: ungroupedPermissions,
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatPermissionCount(count: number): string {
  return count === 1 ? "1 other permission" : `${String(count)} other permissions`;
}

function MistleResourceAccessGroup(input: {
  group: AllowedMistleResourceGroup;
}): React.JSX.Element {
  return (
    <section className="overflow-hidden rounded-md border">
      <div className="bg-muted/50 border-b px-3 py-2 text-sm font-medium">{input.group.label}</div>
      <div className="grid gap-2 p-3 sm:grid-cols-2">
        {input.group.actions.map((action) => (
          <div
            className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm"
            key={action}
          >
            <CheckIcon aria-hidden className="text-primary size-4 shrink-0" />
            {action}
          </div>
        ))}
      </div>
    </section>
  );
}
