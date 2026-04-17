import { BadgeListField, Button, Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
import { ArrowClockwiseIcon, CaretDownIcon, CaretRightIcon, InfoIcon } from "@phosphor-icons/react";
import { useState } from "react";

import {
  formatResourceCountSummary,
  formatResourceLabel,
  formatResourceMetadata,
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
  const errorTooltipMessage = resolveResourceErrorTooltipMessage({
    resource: input.resource,
    resourceItems: input.resourceItems,
  });
  const secondaryStatusText = resolveResourceSecondaryStatusText(input.resource);
  const shouldRenderFooter = secondaryStatusText.length > 0;

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
          {shouldRenderResourceSyncStateText(input.resource.syncState) ? (
            <div className="hidden items-center gap-1 sm:flex">
              <span className="text-destructive text-xs">
                {formatSyncStateLabel(input.resource.syncState)}
              </span>
              {errorTooltipMessage === null ? null : (
                <Tooltip delay={0}>
                  <TooltipTrigger
                    aria-label="View sync failure details"
                    className="inline-flex size-4 items-center justify-center text-destructive/70 transition-colors hover:text-destructive focus-visible:text-destructive"
                  >
                    <InfoIcon aria-hidden className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-80 whitespace-pre-wrap text-left" side="top">
                    {errorTooltipMessage}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
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

function shouldRenderResourceSyncStateText(
  syncState: IntegrationResourceListItemResourceSummary["syncState"],
): boolean {
  return syncState === "error";
}

function resolveResourceSecondaryStatusText(
  resource: IntegrationResourceListItemResourceSummary,
): string {
  if (resource.syncState === "error") {
    return "";
  }

  return formatResourceMetadata(resource);
}

function resolveResourceErrorTooltipMessage(input: {
  resource: IntegrationResourceListItemResourceSummary;
  resourceItems: IntegrationResourceListItemPreviewState | null;
}): string | null {
  if (input.resource.lastErrorMessage !== undefined) {
    return input.resource.lastErrorMessage;
  }

  if (
    input.resourceItems?.errorMessage !== null &&
    input.resourceItems?.errorMessage !== undefined
  ) {
    return input.resourceItems.errorMessage;
  }

  return null;
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

  return <p className="mt-1 text-muted-foreground text-xs">No items available.</p>;
}
