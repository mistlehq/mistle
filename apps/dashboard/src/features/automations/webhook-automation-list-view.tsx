import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mistle/ui";

import { resolveIntegrationLogoPath } from "../integrations/logo.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { useWebhookAutomationListState } from "./use-webhook-automation-list-state.js";
import { WebhookAutomationListToolbar } from "./webhook-automation-list-toolbar.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-types.js";
import type { WebhookAutomationListEvent } from "./webhook-automations-types.js";

function renderAutomationPagination(input: {
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

type WebhookAutomationListViewProps = {
  items: readonly WebhookAutomationListItemViewModel[];
  isLoading: boolean;
  errorMessage: string | null;
  totalResults: number | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  nextPageDisabled?: boolean;
  previousPageDisabled?: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onOpenAutomation: (automationId: string) => void;
  onRetry: () => void;
};

function LoadingState(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function buildEventSummaryTitle(events: readonly WebhookAutomationListEvent[]): string {
  return events
    .map((event) => `${event.label}${event.unavailable === true ? " (Unavailable)" : ""}`)
    .join(", ");
}

export function resolveEventSummary(input: { events: readonly WebhookAutomationListEvent[] }): {
  firstEvent: WebhookAutomationListEvent | null;
  remainingCount: number;
  title: string;
} {
  const [firstEvent, ...remainingEvents] = input.events;

  return {
    firstEvent: firstEvent ?? null,
    remainingCount: remainingEvents.length,
    title: buildEventSummaryTitle(input.events),
  };
}

function EventSummaryCell(input: {
  events: readonly WebhookAutomationListEvent[];
}): React.JSX.Element {
  const eventSummary = resolveEventSummary({
    events: input.events,
  });

  if (eventSummary.firstEvent === null) {
    return <span className="text-muted-foreground">No events</span>;
  }

  return (
    <div className="flex items-center gap-2" title={eventSummary.title}>
      {eventSummary.firstEvent.logoKey === undefined ? null : (
        <img
          alt=""
          aria-hidden
          className="size-4 shrink-0"
          src={resolveIntegrationLogoPath({ logoKey: eventSummary.firstEvent.logoKey })}
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

function AutomationStatusDot(input: { enabled: boolean }): React.JSX.Element {
  return (
    <>
      <span
        aria-hidden
        className={`inline-block size-2 shrink-0 rounded-full ${
          input.enabled ? "bg-emerald-500" : "bg-muted-foreground/35"
        }`}
      />
      <span className="sr-only">{input.enabled ? "Enabled" : "Disabled"}</span>
    </>
  );
}

function AutomationIssueMessage(input: {
  issue: WebhookAutomationListItemViewModel["issue"];
}): React.JSX.Element | null {
  if (input.issue === undefined) {
    return null;
  }

  return <p className="text-destructive text-xs leading-5">{input.issue.message}</p>;
}

function AutomationIdentityCell(input: {
  item: WebhookAutomationListItemViewModel;
  onOpenAutomation: (automationId: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <AutomationStatusDot enabled={input.item.enabled} />
        <button
          className="text-left font-medium underline-offset-4 hover:underline"
          onClick={() => {
            input.onOpenAutomation(input.item.id);
          }}
          type="button"
        >
          {input.item.name}
        </button>
      </div>
      <AutomationIssueMessage issue={input.item.issue} />
    </div>
  );
}

export function WebhookAutomationListView(
  input: WebhookAutomationListViewProps,
): React.JSX.Element {
  const { activeFilter, setActiveFilter, searchValue, setSearchValue, visibleItems, hasItems } =
    useWebhookAutomationListState({
      items: input.items,
    });

  return (
    <div className="flex flex-col gap-4">
      {input.isLoading ? (
        <LoadingState />
      ) : input.errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load automations</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>{input.errorMessage}</span>
            <Button onClick={input.onRetry} type="button" variant="outline">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {input.items.length > 0 ? (
            <WebhookAutomationListToolbar
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              onSearchValueChange={setSearchValue}
              searchValue={searchValue}
            />
          ) : null}

          <Table className="min-w-[56rem] table-fixed">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[22%]" />
              <col className="w-[32%]" />
              <col className="w-[12%]" />
            </colgroup>
            <TableHeader className="bg-muted/60">
              <TableRow className="h-9 border-b">
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Automation
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Target
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Events
                </TableHead>
                <TableHead className="text-foreground py-2 text-xs font-semibold tracking-wide uppercase">
                  Updated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={4}>
                    {hasItems
                      ? "No automations match the current search or filter."
                      : "No automations have been created yet."}
                  </TableCell>
                </TableRow>
              ) : null}
              {visibleItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <AutomationIdentityCell item={item} onOpenAutomation={input.onOpenAutomation} />
                  </TableCell>
                  <TableCell>{item.targetName}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    <EventSummaryCell events={item.events} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
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
        pagination={renderAutomationPagination(input)}
      />
    </div>
  );
}
