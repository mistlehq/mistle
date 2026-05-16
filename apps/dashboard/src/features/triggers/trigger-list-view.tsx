import {
  Notice,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  textLinkVariants,
} from "@mistle/ui";

import { IntegrationLogo } from "../integrations/integration-logo.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { resolveEventSummary } from "./trigger-list-event-summary.js";
import { TriggerIssueIndicator } from "./trigger-list-indicators.js";
import { TriggerListToolbar } from "./trigger-list-toolbar.js";
import type { TriggerListItemViewModel } from "./trigger-list-types.js";
import { useTriggerListState } from "./use-trigger-list-state.js";

function renderTriggerPagination(input: {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextPageDisabled?: boolean;
  previousPageDisabled?: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
}): React.JSX.Element | null {
  if (!input.hasNextPage && !input.hasPreviousPage) {
    return null;
  }

  return (
    <TablePagination
      hasNextPage={input.hasNextPage}
      hasPreviousPage={input.hasPreviousPage}
      onNextPage={input.onNextPage}
      onPreviousPage={input.onPreviousPage}
      {...(input.nextPageDisabled === undefined
        ? {}
        : { nextPageDisabled: input.nextPageDisabled })}
      {...(input.previousPageDisabled === undefined
        ? {}
        : { previousPageDisabled: input.previousPageDisabled })}
    />
  );
}

type TriggerListViewProps = {
  items: readonly TriggerListItemViewModel[];
  errorMessage: string | null;
  totalResults: number | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextPageDisabled?: boolean;
  previousPageDisabled?: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onOpenTrigger: (trigger: { id: string; kind: TriggerListItemViewModel["kind"] }) => void;
};

function EventSummaryCell(input: {
  item: Extract<TriggerListItemViewModel["source"], { kind: "webhook" }>;
}): React.JSX.Element {
  const eventSummary = resolveEventSummary({
    events: input.item.events,
  });

  if (eventSummary.firstEvent === null) {
    return <span className="text-muted-foreground">No events</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2" title={eventSummary.title}>
      {eventSummary.firstEvent.logoKey === undefined ? null : (
        <IntegrationLogo
          alt=""
          className="size-4 shrink-0"
          logoKey={eventSummary.firstEvent.logoKey}
        />
      )}
      <span className="truncate">{eventSummary.firstEvent.label}</span>
      {eventSummary.firstEvent.unavailable === true ? (
        <span className="text-destructive text-xs whitespace-nowrap">Unavailable</span>
      ) : null}
      {eventSummary.remainingCount === 0 ? null : (
        <span className="text-muted-foreground shrink-0 text-xs">
          +{eventSummary.remainingCount}
        </span>
      )}
    </div>
  );
}

function ScheduleSummaryCell(input: {
  item: Extract<TriggerListItemViewModel["source"], { kind: "schedule" }>;
}): React.JSX.Element {
  const scheduleTiming =
    input.item.nextScheduledAtLabel === null
      ? `Not scheduled · ${input.item.timezoneOffsetLabel}`
      : `Next ${input.item.nextScheduledAtLabel} ${input.item.timezoneOffsetLabel}`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate font-mono text-xs text-foreground">
        {input.item.cronExpression}
      </span>
      <span className="truncate text-xs">{scheduleTiming}</span>
    </div>
  );
}

function SourceDetailsCell(input: { item: TriggerListItemViewModel }): React.JSX.Element {
  if (input.item.source.kind === "webhook") {
    return <EventSummaryCell item={input.item.source} />;
  }

  return <ScheduleSummaryCell item={input.item.source} />;
}

function TriggerIdentityCell(input: {
  item: TriggerListItemViewModel;
  onOpenTrigger: TriggerListViewProps["onOpenTrigger"];
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <TriggerIssueIndicator enabled={input.item.enabled} issue={input.item.issue} />
        <button
          className={textLinkVariants({
            variant: "listItem",
            className: "text-left break-words",
          })}
          onClick={() => {
            input.onOpenTrigger({ id: input.item.id, kind: input.item.kind });
          }}
          type="button"
        >
          {input.item.name}
        </button>
      </div>
    </div>
  );
}

function TargetCell(input: { item: TriggerListItemViewModel }): React.JSX.Element {
  const sandboxProfileName =
    input.item.target.sandboxProfileName ?? input.item.target.sandboxProfileId;
  const repositoryName = input.item.target.primaryRepositoryName ?? "Workspace root";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-sm text-foreground">{sandboxProfileName}</span>
      <span className="truncate text-xs text-muted-foreground">{repositoryName}</span>
    </div>
  );
}

export function TriggerListView(input: TriggerListViewProps): React.JSX.Element {
  const { activeFilter, setActiveFilter, searchValue, setSearchValue, visibleItems, hasItems } =
    useTriggerListState({
      items: input.items,
    });

  return (
    <div className="flex flex-col gap-4">
      {input.errorMessage !== null ? (
        <Notice title="Could not load triggers" variant="alert">
          {input.errorMessage}
        </Notice>
      ) : (
        <>
          {input.items.length > 0 ? (
            <TriggerListToolbar
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              onSearchValueChange={setSearchValue}
              searchValue={searchValue}
            />
          ) : null}

          <Table className="table-fixed">
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[36%]" />
              <col className="w-[22%]" />
              <col className="w-[6rem]" />
            </colgroup>
            <TableHeader className="bg-muted/60">
              <TableRow className="h-9 border-b">
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Trigger
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  When
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Runs with
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase whitespace-nowrap">
                  Updated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={4}>
                    {hasItems
                      ? "No triggers match the current search or filter."
                      : "No triggers have been created yet."}
                  </TableCell>
                </TableRow>
              ) : null}
              {visibleItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal">
                    <TriggerIdentityCell item={item} onOpenTrigger={input.onOpenTrigger} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-normal">
                    <SourceDetailsCell item={item} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <TargetCell item={item} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {item.updatedAtLabel}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <TableListingFooter
        resultsCount={
          input.totalResults === null ? null : (
            <p className="text-muted-foreground text-sm">
              Showing {visibleItems.length} of {input.totalResults}
            </p>
          )
        }
        pagination={renderTriggerPagination(input)}
      />
    </div>
  );
}
