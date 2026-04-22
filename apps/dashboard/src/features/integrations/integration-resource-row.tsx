import { BadgeListField, Button, Tooltip, TooltipContent, TooltipTrigger } from "@mistle/ui";
import { ArrowClockwiseIcon, CaretDownIcon, CaretRightIcon, InfoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  formatResourceLabel,
  formatResourceMetadata,
  formatSyncStateLabel,
} from "./integration-connection-detail-formatters.js";
import {
  listIntegrationConnectionResources,
  type IntegrationConnectionResource,
} from "./integrations-service.js";

export type IntegrationResourceListItemResourceSummary = {
  count: number;
  isRefreshing?: boolean;
  kind: string;
  lastErrorMessage?: string;
  lastSyncedAt?: string;
  syncState: "never-synced" | "syncing" | "ready" | "error";
};

export type IntegrationResourceListItemData = {
  isLoading: boolean;
  items: readonly IntegrationConnectionResource[];
  kind: string;
  errorMessage: string | null;
};

export type IntegrationResourceListItemProps = {
  connectionId: string;
  onRefreshResource?: (input: { connectionId: string; kind: string }) => void;
  resource: IntegrationResourceListItemResourceSummary;
  resourceItems: IntegrationResourceListItemData | null;
};

export function IntegrationResourceListItem(
  input: IntegrationResourceListItemProps,
): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const resourceLabel = formatResourceLabel(input.resource.kind);
  const resourceCount = input.resource.count;
  const errorTooltipMessage =
    input.resource.lastErrorMessage ?? input.resourceItems?.errorMessage ?? null;
  const secondaryStatusText =
    input.resource.syncState === "error"
      ? ""
      : formatResourceMetadata({
          syncState: input.resource.syncState,
          ...(input.resource.lastSyncedAt === undefined
            ? {}
            : { lastSyncedAt: input.resource.lastSyncedAt }),
        });
  const statusSummary = `${resourceCount} resources. `;
  let statusContent: React.JSX.Element | null = null;

  if (input.resource.syncState === "error") {
    statusContent = (
      <div className="flex items-center justify-end gap-1">
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
    );
  } else if (secondaryStatusText.length > 0) {
    statusContent = <span className="truncate">{secondaryStatusText}</span>;
  }

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
        </div>
        {statusContent === null ? null : (
          <div className="hidden min-w-0 flex-1 items-center justify-end gap-2 sm:flex sm:shrink-0">
            <div
              className={`min-w-0 text-right text-xs ${input.resource.syncState === "error" ? "" : "text-muted-foreground"}`}
            >
              <span className="sr-only">{statusSummary}</span>
              {statusContent}
            </div>
          </div>
        )}
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
      {renderExpandedResourceSection(
        isExpanded,
        input.connectionId,
        input.resource,
        input.resourceItems,
      )}
      {statusContent === null ? null : (
        <div className="mt-1 pt-1 sm:hidden">
          <div
            className={`flex min-w-0 items-center justify-end gap-1.5 pr-2 text-xs sm:pl-5 ${
              input.resource.syncState === "error" ? "" : "text-muted-foreground"
            }`}
          >
            <span className="sr-only">{statusSummary}</span>
            <div className="min-w-0">{statusContent}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderExpandedResourceSection(
  isExpanded: boolean,
  connectionId: string,
  resource: IntegrationResourceListItemResourceSummary,
  resourceItems: IntegrationResourceListItemData | null,
): React.JSX.Element | null {
  if (isExpanded === false) {
    return null;
  }

  if (resource.syncState === "never-synced") {
    return renderExpandedResourceItems({
      errorMessage: null,
      isLoading: false,
      items: [],
      kind: resource.kind,
    });
  }

  if (resourceItems !== null) {
    return renderExpandedResourceItems(resourceItems);
  }

  return (
    <LazyExpandedResourceItems
      connectionId={connectionId}
      kind={resource.kind}
      syncState={resource.syncState}
    />
  );
}

function LazyExpandedResourceItems(input: {
  connectionId: string;
  kind: string;
  syncState: IntegrationResourceListItemResourceSummary["syncState"];
}): React.JSX.Element {
  const resourceItemsQuery = useQuery({
    queryKey: ["settings", "integrations", "connection-resources", input.connectionId, input.kind],
    queryFn: async ({ signal }) =>
      listIntegrationConnectionResources({
        connectionId: input.connectionId,
        kind: input.kind,
        signal,
      }),
    retry: false,
    refetchInterval: input.syncState === "syncing" ? 3_000 : false,
  });

  return renderExpandedResourceItems({
    errorMessage:
      resourceItemsQuery.isError === true
        ? resolveApiErrorMessage({
            error: resourceItemsQuery.error,
            fallbackMessage: `Could not load ${input.kind}.`,
          })
        : null,
    isLoading: resourceItemsQuery.isPending,
    items: resourceItemsQuery.data?.items ?? [],
    kind: input.kind,
  });
}

function renderExpandedResourceItems(
  resourceItems: IntegrationResourceListItemData,
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
