import {
  Badge,
  BadgeListField,
  Button,
  Notice,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { ArrowClockwiseIcon, CaretDownIcon, CaretRightIcon, InfoIcon } from "@phosphor-icons/react";
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
  const resourceStateIndicator = resolveResourceStateIndicator({
    errorMessage: input.resourceItems?.errorMessage ?? null,
    kindLabel: resourceLabel,
    previewState: input.resourceItems?.previewState ?? null,
  });
  const shouldReplaceMetadataWithPreviewError = input.resourceItems?.previewState === "error";

  return (
    <div
      className={`pl-3 pr-1 py-1 flex flex-col ${isExpanded ? "pb-2" : ""}`}
      data-slot="integration-resource-list-item"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex items-center gap-2">
          <Button
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${resourceLabel.toLowerCase()} resources`}
            className="-ml-2 h-auto justify-start rounded-sm px-1 py-0 text-left text-muted-foreground shadow-none transition-colors hover:bg-transparent hover:text-foreground"
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
          {shouldShowResourceSyncStateBadge(input.resource.syncState) ? (
            <Badge variant="secondary">{formatSyncStateLabel(input.resource.syncState)}</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          {shouldReplaceMetadataWithPreviewError ? (
            <div className="flex items-center">{resourceStateIndicator}</div>
          ) : (
            <div className="text-muted-foreground text-xs">
              <span className="sr-only">{formatResourceCountSummary(input.resource)}. </span>
              {formatResourceInlineMetadata(input.resource)}
            </div>
          )}
          {input.onRefreshResource ? (
            <Button
              aria-label={`Refresh ${input.resource.kind}`}
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
      </div>
      {input.resource.lastErrorMessage ? (
        <Notice variant="alert">{input.resource.lastErrorMessage}</Notice>
      ) : null}
      {isExpanded && input.resourceItems !== null && input.resourceItems.items.length > 0 ? (
        <div>
          <BadgeListField
            items={input.resourceItems.items.map((item) => ({
              id: item.id,
              label: item.displayName,
            }))}
          />
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

function resolveResourceStateIndicator(input: {
  errorMessage: string | null;
  kindLabel: string;
  previewState: "error" | "not-synced" | null;
}): React.JSX.Element | null {
  if (input.previewState === "error" && input.errorMessage !== null) {
    return (
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label={`View ${input.kindLabel.toLowerCase()} load error`}
          render={<Badge render={<span aria-hidden="true" />} variant="destructive" />}
        >
          Error
          <InfoIcon className="size-3.5" data-icon="inline-end" />
        </TooltipTrigger>
        <TooltipContent className="max-w-80 whitespace-pre-wrap text-left" side="top">
          {input.errorMessage}
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
