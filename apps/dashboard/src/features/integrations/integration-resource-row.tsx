import { Badge, BadgeListField, Button, Notice } from "@mistle/ui";
import { ArrowClockwiseIcon, CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";

import {
  formatResourceCountSummary,
  formatResourceInlineMetadata,
  formatResourceLabel,
  formatSyncStateLabel,
} from "./integration-connection-detail-formatters.js";
import type { IntegrationConnectionResource } from "./integrations-service.js";

export type IntegrationResourceListItemResourceSummary = {
  count: number;
  isRefreshing?: boolean;
  kind: string;
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
};

export type IntegrationResourceListItemPreviewState = {
  errorMessage: string | null;
  isLoading: boolean;
  items: readonly IntegrationConnectionResource[];
  kind: string;
  previewState: "error" | "not-synced" | null;
};

export type IntegrationResourceListItemProps = {
  connectionId: string;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resource: IntegrationResourceListItemResourceSummary;
  resourceItems: IntegrationResourceListItemPreviewState | null;
};

export function IntegrationResourceListItem(
  input: IntegrationResourceListItemProps,
): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const resourceLabel = formatResourceLabel(input.resource.kind);
  const resourceCount = input.resource.count;
  const hasPreviewError = input.resourceItems?.previewState === "error";
  const secondaryStatusText = resolveResourceSecondaryStatusText({
    resource: input.resource,
    previewState: input.resourceItems?.previewState ?? null,
  });
  const shouldRenderFooter = secondaryStatusText.length > 0 || hasPreviewError;

  return (
    <div
      className={`px-3 py-2 flex flex-col ${isExpanded ? "pb-3" : ""}`}
      data-slot="integration-resource-list-item"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex flex-1 items-center gap-2">
          <Button
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${resourceLabel.toLowerCase()} resources`}
            className="-ml-2 h-auto min-w-0 flex-1 justify-start rounded-sm px-1 py-0 text-left text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground"
            onClick={() => {
              setIsExpanded((current) => !current);
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {isExpanded ? (
              <CaretDownIcon aria-hidden className="size-4" />
            ) : (
              <CaretRightIcon aria-hidden className="size-4" />
            )}
            <span className="text-xs uppercase tracking-wide leading-tight">
              {resourceLabel} <span className="text-current/80">- {resourceCount}</span>
            </span>
          </Button>
          {shouldShowResourceSyncStateBadge(input.resource.syncState) && !hasPreviewError ? (
            <Badge className="hidden sm:inline-flex" variant="secondary">
              {formatSyncStateLabel(input.resource.syncState)}
            </Badge>
          ) : null}
        </div>
        <div className="hidden min-w-0 items-center gap-2 sm:flex sm:shrink-0">
          <div className="text-muted-foreground text-xs">
            <span className="sr-only">{formatResourceCountSummary(input.resource)}. </span>
            {secondaryStatusText}
          </div>
        </div>
        {input.onRefreshResource ? (
          <Button
            aria-label={`Refresh ${input.resource.kind}`}
            className="shrink-0"
            disabled={input.resource.isRefreshing === true}
            onClick={() => {
              input.onRefreshResource?.({
                connectionId: input.connectionId,
                kind: input.resource.kind,
              });
            }}
            size="icon-sm"
            title="Sync resource"
            type="button"
            variant="ghost"
          >
            <ArrowClockwiseIcon
              aria-hidden
              className={input.resource.isRefreshing === true ? "size-4 animate-spin" : "size-4"}
            />
          </Button>
        ) : null}
      </div>
      {input.resource.lastErrorMessage ? (
        <Notice variant="alert">{input.resource.lastErrorMessage}</Notice>
      ) : null}
      {isExpanded && input.resourceItems !== null
        ? renderExpandedResourceItems(input.resourceItems)
        : null}
      {shouldRenderFooter ? (
        <div className="mt-1 pt-1 sm:hidden">
          <div className="flex min-w-0 items-center gap-1.5 pr-2 text-muted-foreground text-xs sm:pl-5">
            <span className="sr-only">{formatResourceCountSummary(input.resource)}. </span>
            <span className="min-w-0 truncate">{secondaryStatusText}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function shouldShowResourceSyncStateBadge(
  syncState: IntegrationResourceListItemResourceSummary["syncState"],
): boolean {
  return syncState !== "ready" && syncState !== "syncing" && syncState !== "never-synced";
}

function resolveResourceSecondaryStatusText(input: {
  resource: IntegrationResourceListItemResourceSummary;
  previewState: "error" | "not-synced" | null;
}): string {
  if (input.previewState === "error") {
    return "Sync failed";
  }

  return formatResourceInlineMetadata(input.resource);
}

function renderExpandedResourceItems(
  resourceItems: IntegrationResourceListItemPreviewState,
): React.JSX.Element {
  if (resourceItems.items.length > 0) {
    return (
      <div className="mt-1">
        <BadgeListField
          badgeClassName="px-2 py-0.5 text-[11px] sm:px-2.5 sm:py-1 sm:text-xs"
          items={resourceItems.items.map((item) => ({
            id: item.id,
            label: item.displayName,
          }))}
        />
      </div>
    );
  }

  if (resourceItems.isLoading) {
    return <p className="mt-1 text-muted-foreground text-xs">Loading items...</p>;
  }

  if (resourceItems.previewState === "not-synced") {
    return <p className="mt-1 text-muted-foreground text-xs">Not synced yet.</p>;
  }

  return <p className="mt-1 text-muted-foreground text-xs">No items available.</p>;
}
