import {
  Badge,
  Button,
  DropdownMenuItem,
  MoreActionsMenu,
  Notice,
  OverflowTooltipText,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextLink,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { InfoIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { formatCompactSandboxProfileVersion } from "../sandbox-profiles/sandbox-profile-version-labels.js";
import { useLaunchableSandboxProfiles } from "../sandbox-profiles/use-launchable-sandbox-profiles.js";
import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import { deleteSandboxInstance, listSandboxInstances } from "../sessions/sessions-service.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { CollectionEmptyState } from "../shared/collection-empty-state.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import { PageFrame } from "../shared/page-frame.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { ToolbarSearchInput } from "../shared/toolbar-search-input.js";
import { SessionsRoutes } from "../shell/app-shell-sessions-sidebar-mode.js";
import { triggersListQueryKey } from "../triggers/triggers-query-keys.js";
import { listTriggers } from "../triggers/triggers-service.js";
import type { TriggerListItem } from "../triggers/triggers-types.js";
import {
  resolveSandboxStatusBadgeUi,
  type SandboxLifecycleStatus,
} from "./sandbox-status-presentation.js";

const SANDBOX_INSTANCE_LIST_LIMIT = 20;
const SANDBOX_INSTANCE_LIST_MAX_LIMIT = 100;
const SESSION_FILTER_TRIGGER_LIST_LIMIT = 100;
const SessionTitleTooltipSideOffset = 8;

type SessionOwnerFilter = "anyone" | "me";
type SessionStartedFromFilter = "any" | "manual" | "trigger" | "event" | "schedule";

type SessionListFilters = {
  search: string;
  owner: SessionOwnerFilter;
  startedFrom: SessionStartedFromFilter;
  triggerId: string | null;
};

type SessionsEmptyStateRenderState =
  | {
      kind: "none";
    }
  | {
      kind: "launchableProfilesError";
      message: string;
    }
  | {
      kind: "pendingLaunchableProfiles";
    }
  | {
      kind: "startSession";
    }
  | {
      kind: "publishProfile";
    };

function parseListLimit(rawValue: string | null): number {
  if (rawValue === null) {
    return SANDBOX_INSTANCE_LIST_LIMIT;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed)) {
    return SANDBOX_INSTANCE_LIST_LIMIT;
  }

  if (parsed < 1 || parsed > SANDBOX_INSTANCE_LIST_MAX_LIMIT) {
    return SANDBOX_INSTANCE_LIST_LIMIT;
  }

  return parsed;
}

function parseOwnerFilter(rawValue: string | null): SessionOwnerFilter {
  if (rawValue === "me") {
    return rawValue;
  }

  return "anyone";
}

function parseStartedFromFilter(rawValue: string | null): SessionStartedFromFilter {
  if (
    rawValue === "manual" ||
    rawValue === "trigger" ||
    rawValue === "event" ||
    rawValue === "schedule"
  ) {
    return rawValue;
  }

  return "any";
}

function resolveOwnerFilterLabel(owner: SessionOwnerFilter): string {
  if (owner === "me") {
    return "Me";
  }

  return "Anyone";
}

function resolveStartedFromFilterLabel(startedFrom: SessionStartedFromFilter): string {
  if (startedFrom === "manual") {
    return "Manual";
  }

  if (startedFrom === "trigger") {
    return "Any trigger";
  }

  if (startedFrom === "event") {
    return "Event trigger";
  }

  if (startedFrom === "schedule") {
    return "Scheduled trigger";
  }

  return "Any";
}

function resolveStartedFromSelectedLabel(input: {
  filters: SessionListFilters;
  triggerOptions: readonly TriggerListItem[];
}): string {
  if (input.filters.triggerId === null) {
    return `Started from: ${resolveStartedFromFilterLabel(input.filters.startedFrom)}`;
  }

  return `Trigger: ${
    input.triggerOptions.find((trigger) => trigger.id === input.filters.triggerId)?.name ??
    "Specific trigger"
  }`;
}

function readSessionListFilters(searchParams: URLSearchParams): SessionListFilters {
  const startedFrom = parseStartedFromFilter(searchParams.get("startedFrom"));
  const triggerId = searchParams.get("triggerId");

  return {
    search: searchParams.get("search")?.trim() ?? "",
    owner: parseOwnerFilter(searchParams.get("owner")),
    startedFrom,
    triggerId: startedFrom === "trigger" && triggerId !== null ? triggerId : null,
  };
}

function hasActiveSessionListFilters(filters: SessionListFilters): boolean {
  return (
    filters.search.length > 0 ||
    filters.owner !== "anyone" ||
    filters.startedFrom !== "any" ||
    filters.triggerId !== null
  );
}

function SessionTitleCell(input: { href?: string; title: string }): React.JSX.Element {
  const titleText = (
    <OverflowTooltipText
      className={
        input.href === undefined
          ? "cursor-default font-medium text-muted-foreground"
          : "cursor-default font-medium group-hover/session-row:underline group-focus-within/session-row:underline"
      }
      containerClassName="flex-1"
      text={input.title}
      tooltipSide="right"
      tooltipSideOffset={SessionTitleTooltipSideOffset}
    />
  );

  if (input.href === undefined) {
    return <span className="flex max-w-full items-center gap-1">{titleText}</span>;
  }

  return (
    <TextLink
      className="flex max-w-full items-center gap-1 group-hover/session-row:underline group-focus-within/session-row:underline"
      render={<RouterLink to={input.href} />}
      variant="listItem"
    >
      {titleText}
    </TextLink>
  );
}

function SessionRowActions(input: {
  isDisabled: boolean;
  onRequestDelete: () => void;
  sessionTitle: string;
}): React.JSX.Element {
  return (
    <MoreActionsMenu
      disabled={input.isDisabled}
      triggerLabel={`Session actions for ${input.sessionTitle}`}
      triggerSize="icon-xs"
    >
      <DropdownMenuItem onClick={input.onRequestDelete} variant="destructive">
        <TrashIcon aria-hidden className="size-4" />
        Delete session
      </DropdownMenuItem>
    </MoreActionsMenu>
  );
}

function resolveSessionsEmptyState(input: {
  hasNoSessions: boolean;
  isLoadingSessions: boolean;
  launchableProfilesErrorMessage: string | null;
  launchableProfilesCount: number;
  launchableProfilesPending: boolean;
}): SessionsEmptyStateRenderState {
  if (input.isLoadingSessions || !input.hasNoSessions) {
    return { kind: "none" };
  }

  if (input.launchableProfilesErrorMessage !== null) {
    return {
      kind: "launchableProfilesError",
      message: input.launchableProfilesErrorMessage,
    };
  }

  if (input.launchableProfilesPending) {
    return { kind: "pendingLaunchableProfiles" };
  }

  if (input.launchableProfilesCount > 0) {
    return { kind: "startSession" };
  }

  return { kind: "publishProfile" };
}

function SessionsEmptyState(input: {
  state: SessionsEmptyStateRenderState;
}): React.JSX.Element | null {
  if (input.state.kind === "none") {
    return null;
  }

  if (input.state.kind === "launchableProfilesError") {
    return (
      <Notice title="Could not load launchable sandbox profiles" variant="alert">
        {input.state.message}
      </Notice>
    );
  }

  if (input.state.kind === "pendingLaunchableProfiles") {
    return <div className="min-h-64" />;
  }

  if (input.state.kind === "startSession") {
    return (
      <CollectionEmptyState
        action={
          <Button nativeButton={false} render={<RouterLink to={SessionsRoutes.NEW} />}>
            <PlusIcon aria-hidden className="size-4" />
            New session
          </Button>
        }
        description="Starting a session creates a sandbox based on one of your published sandbox profiles."
        title="Start your first session"
      />
    );
  }

  return (
    <CollectionEmptyState
      action={
        <Button nativeButton={false} render={<RouterLink to="/sandbox-profiles" />}>
          <PlusIcon aria-hidden className="size-4" />
          Open sandbox profiles
        </Button>
      }
      description="Sessions need a launchable sandbox profile. Create or publish a sandbox profile before starting one."
      title="Publish a sandbox profile to start sessions"
    />
  );
}

function formatStartedByLabel(input: SandboxInstanceListItem["startedBy"]): string {
  if (input.name !== null) {
    return input.name;
  }

  if (input.kind === "system") {
    return "System";
  }

  return "User";
}

function resolveUpdatedLabel(input: {
  status: SandboxLifecycleStatus;
  updatedAt: string;
  failureMessage: string | null;
}): React.JSX.Element {
  if (input.status === "failed") {
    const statusUi = resolveSandboxStatusBadgeUi(input.status);

    if (input.failureMessage === null) {
      return (
        <Badge className={statusUi.className} variant={statusUi.variant}>
          {statusUi.label}
        </Badge>
      );
    }

    return (
      <Tooltip delay={0}>
        <TooltipTrigger
          aria-label="View failure details"
          render={
            <Badge
              className={statusUi.className}
              render={<span aria-hidden="true" />}
              variant={statusUi.variant}
            />
          }
        >
          {statusUi.label}
          <InfoIcon className="size-3.5" data-icon="inline-end" />
        </TooltipTrigger>
        <TooltipContent className="max-w-80 whitespace-pre-wrap text-left" side="top">
          {input.failureMessage}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span className="text-muted-foreground text-sm whitespace-nowrap">
      {formatCompactRelativeOrDate(input.updatedAt)}
    </span>
  );
}

function SessionsListToolbar(input: {
  filters: SessionListFilters;
  triggerOptions: readonly TriggerListItem[];
  onFiltersChange: (nextFilters: SessionListFilters) => void;
  onClearFilters: () => void;
}): React.JSX.Element {
  const startedFromValue = input.filters.triggerId ?? input.filters.startedFrom;
  const hasActiveFilters = hasActiveSessionListFilters(input.filters);

  function updateSearch(nextSearch: string): void {
    input.onFiltersChange({
      ...input.filters,
      search: nextSearch,
    });
  }

  function updateOwner(nextOwner: string | null): void {
    if (nextOwner === null) {
      return;
    }

    if (nextOwner !== "anyone" && nextOwner !== "me") {
      return;
    }

    input.onFiltersChange({
      ...input.filters,
      owner: nextOwner,
    });
  }

  function updateStartedFrom(nextStartedFrom: string | null): void {
    if (nextStartedFrom === null) {
      return;
    }

    if (
      nextStartedFrom === "any" ||
      nextStartedFrom === "manual" ||
      nextStartedFrom === "trigger" ||
      nextStartedFrom === "event" ||
      nextStartedFrom === "schedule"
    ) {
      input.onFiltersChange({
        ...input.filters,
        startedFrom: nextStartedFrom,
        triggerId: null,
      });
      return;
    }

    const matchingTrigger = input.triggerOptions.find((trigger) => trigger.id === nextStartedFrom);
    if (matchingTrigger === undefined) {
      return;
    }

    input.onFiltersChange({
      ...input.filters,
      startedFrom: "trigger",
      triggerId: matchingTrigger.id,
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <ToolbarSearchInput
        ariaLabel="Search sessions"
        onValueChange={updateSearch}
        placeholder="Search sessions"
        value={input.filters.search}
      />

      <Select onValueChange={updateOwner} value={input.filters.owner}>
        <SelectTrigger aria-label="Filter sessions by owner" className="w-full sm:w-44">
          <SelectValue placeholder="Owner">
            Owner: {resolveOwnerFilterLabel(input.filters.owner)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="anyone">Anyone</SelectItem>
          <SelectItem value="me">Me</SelectItem>
        </SelectContent>
      </Select>

      <Select onValueChange={updateStartedFrom} value={startedFromValue}>
        <SelectTrigger aria-label="Filter sessions by start source" className="w-full sm:w-60">
          <SelectValue placeholder="Started from">
            {resolveStartedFromSelectedLabel({
              filters: input.filters,
              triggerOptions: input.triggerOptions,
            })}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any</SelectItem>
          <SelectItem value="manual">Manual</SelectItem>
          <SelectItem value="event">Event trigger</SelectItem>
          <SelectItem value="schedule">Scheduled trigger</SelectItem>
          <SelectItem value="trigger">Any trigger</SelectItem>
          {input.triggerOptions.map((trigger) => (
            <SelectItem key={trigger.id} value={trigger.id}>
              {trigger.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters ? (
        <Button onClick={input.onClearFilters} type="button" variant="secondary">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

export function SessionsPage(): React.JSX.Element {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sandboxInstanceListLimit = parseListLimit(searchParams.get("limit"));
  const { after: sandboxInstancesAfter, before: sandboxInstancesBefore } =
    readKeysetPaginationCursors(searchParams);
  const filters = readSessionListFilters(searchParams);

  const sandboxInstancesQuery = useQuery({
    queryKey: sandboxInstancesListQueryKey({
      limit: sandboxInstanceListLimit,
      after: sandboxInstancesAfter,
      before: sandboxInstancesBefore,
      search: filters.search,
      owner: filters.owner,
      startedFrom: filters.startedFrom,
      triggerId: filters.triggerId,
    }),
    queryFn: async ({ signal }) =>
      listSandboxInstances({
        limit: sandboxInstanceListLimit,
        after: sandboxInstancesAfter,
        before: sandboxInstancesBefore,
        ...(filters.search.length === 0 ? {} : { search: filters.search }),
        ...(filters.owner === "anyone" ? {} : { owner: filters.owner }),
        ...(filters.startedFrom === "any" ? {} : { startedFrom: filters.startedFrom }),
        ...(filters.triggerId === null ? {} : { triggerId: filters.triggerId }),
        signal,
      }),
    placeholderData: keepPreviousData,
  });
  const triggerOptionsQuery = useQuery({
    queryKey: triggersListQueryKey({
      limit: SESSION_FILTER_TRIGGER_LIST_LIMIT,
      after: null,
      before: null,
    }),
    queryFn: async ({ signal }) =>
      listTriggers({
        limit: SESSION_FILTER_TRIGGER_LIST_LIMIT,
        after: null,
        before: null,
        signal,
      }),
  });
  const displayedSessions = sandboxInstancesQuery.data?.items ?? [];
  const deleteSessionMutation = useMutation({
    mutationFn: async (session: SandboxInstanceListItem) =>
      deleteSandboxInstance({
        instanceId: session.id,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["sandbox-instances", "list"],
      });
    },
  });

  const deleteSessionErrorMessage = deleteSessionMutation.isError
    ? resolveApiErrorMessage({
        error: deleteSessionMutation.error,
        fallbackMessage: "Could not delete sandbox session.",
      })
    : null;

  function requestDeleteSession(session: SandboxInstanceListItem): void {
    deleteSessionMutation.reset();
    deleteSessionMutation.mutate(session);
  }

  function updatePagination(input: {
    nextLimit: number;
    nextAfter: string | null;
    nextBefore: string | null;
  }): void {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("limit", String(input.nextLimit));
    if (input.nextAfter === null) {
      nextSearchParams.delete("after");
    } else {
      nextSearchParams.set("after", input.nextAfter);
    }
    if (input.nextBefore === null) {
      nextSearchParams.delete("before");
    } else {
      nextSearchParams.set("before", input.nextBefore);
    }
    setSearchParams(nextSearchParams);
  }

  function updateFilters(nextFilters: SessionListFilters): void {
    const nextSearchParams = new URLSearchParams(searchParams);

    nextSearchParams.set("limit", String(sandboxInstanceListLimit));
    nextSearchParams.delete("after");
    nextSearchParams.delete("before");

    if (nextFilters.search.trim().length === 0) {
      nextSearchParams.delete("search");
    } else {
      nextSearchParams.set("search", nextFilters.search.trim());
    }

    if (nextFilters.owner === "anyone") {
      nextSearchParams.delete("owner");
    } else {
      nextSearchParams.set("owner", nextFilters.owner);
    }

    if (nextFilters.startedFrom === "any") {
      nextSearchParams.delete("startedFrom");
    } else {
      nextSearchParams.set("startedFrom", nextFilters.startedFrom);
    }

    if (nextFilters.triggerId === null) {
      nextSearchParams.delete("triggerId");
    } else {
      nextSearchParams.set("startedFrom", "trigger");
      nextSearchParams.set("triggerId", nextFilters.triggerId);
    }

    setSearchParams(nextSearchParams);
  }

  function clearFilters(): void {
    updateFilters({
      search: "",
      owner: "anyone",
      startedFrom: "any",
      triggerId: null,
    });
  }

  const isSessionListTransitionPending =
    sandboxInstancesQuery.isPending || sandboxInstancesQuery.isPlaceholderData;

  function goToNextPage(): void {
    if (isSessionListTransitionPending) {
      return;
    }

    const nextPage = sandboxInstancesQuery.data?.nextPage;
    if (nextPage === null || nextPage === undefined) {
      return;
    }

    updatePagination({
      nextLimit: nextPage.limit,
      nextAfter: nextPage.after,
      nextBefore: null,
    });
  }

  function goToPreviousPage(): void {
    if (isSessionListTransitionPending) {
      return;
    }

    const previousPage = sandboxInstancesQuery.data?.previousPage;
    if (previousPage === null || previousPage === undefined) {
      return;
    }

    updatePagination({
      nextLimit: previousPage.limit,
      nextAfter: null,
      nextBefore: previousPage.before,
    });
  }

  const listErrorMessage = sandboxInstancesQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxInstancesQuery.error,
        fallbackMessage: "Could not load sandbox instances.",
      })
    : null;

  const isLoadingSessions = isSessionListTransitionPending;
  const hasActiveFilters = hasActiveSessionListFilters(filters);
  const hasNoSessions =
    !sandboxInstancesQuery.isPlaceholderData &&
    sandboxInstancesQuery.data?.totalResults === 0 &&
    !hasActiveFilters;
  const shouldLoadLaunchableProfiles =
    !isLoadingSessions && listErrorMessage === null && hasNoSessions;
  const launchableProfilesQuery = useLaunchableSandboxProfiles({
    enabled: shouldLoadLaunchableProfiles,
  });
  const launchableProfilesErrorMessage =
    shouldLoadLaunchableProfiles && launchableProfilesQuery.isError
      ? resolveApiErrorMessage({
          error: launchableProfilesQuery.error,
          fallbackMessage: "Could not load launchable sandbox profiles.",
        })
      : null;
  const sessionsEmptyState = resolveSessionsEmptyState({
    hasNoSessions,
    isLoadingSessions,
    launchableProfilesCount: launchableProfilesQuery.data?.items.length ?? 0,
    launchableProfilesErrorMessage,
    launchableProfilesPending: launchableProfilesQuery.isPending,
  });
  const canShowSessionList =
    sandboxInstancesQuery.data !== undefined && (!hasNoSessions || hasActiveFilters);

  const hasNextPage = sandboxInstancesQuery.data?.nextPage != null;
  const hasPreviousPage = sandboxInstancesQuery.data?.previousPage != null;
  const nextPageDisabled = isSessionListTransitionPending;
  const previousPageDisabled = isSessionListTransitionPending;
  return (
    <PageFrame
      headerActions={
        sessionsEmptyState.kind === "publishProfile" ? (
          <Button
            disabled
            title="Publish a sandbox profile before starting a session."
            type="button"
          >
            <PlusIcon aria-hidden className="size-4" />
            New session
          </Button>
        ) : (
          <Button nativeButton={false} render={<RouterLink to={SessionsRoutes.NEW} />}>
            <PlusIcon aria-hidden className="size-4" />
            New session
          </Button>
        )
      }
      title="Sessions"
    >
      <div className="flex flex-col gap-3">
        {listErrorMessage === null ? null : (
          <Notice title="Could not load sandbox instances" variant="alert">
            {listErrorMessage}
          </Notice>
        )}
        {deleteSessionErrorMessage === null ? null : (
          <Notice title="Delete failed" variant="alert">
            {deleteSessionErrorMessage}
          </Notice>
        )}

        <SessionsEmptyState state={sessionsEmptyState} />

        {canShowSessionList ? (
          <>
            <SessionsListToolbar
              filters={filters}
              onClearFilters={clearFilters}
              onFiltersChange={updateFilters}
              triggerOptions={triggerOptionsQuery.data?.items ?? []}
            />

            <Table className="min-w-[44rem] table-fixed">
              <TableHeader className="bg-muted/60">
                <TableRow className="h-9 border-b">
                  <TableHead className="text-foreground w-[34%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                    Sessions
                  </TableHead>
                  <TableHead className="text-foreground w-[19%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                    Sandbox profile
                  </TableHead>
                  <TableHead className="text-foreground w-[17%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                    Started by
                  </TableHead>
                  <TableHead className="text-foreground w-[13%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                    Created
                  </TableHead>
                  <TableHead className="text-right text-foreground w-[11%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                    Updated
                  </TableHead>
                  <TableHead className="w-[6%] py-2">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedSessions.length === 0 && hasActiveFilters ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      No sessions match these filters.
                    </TableCell>
                  </TableRow>
                ) : null}
                {displayedSessions.map((session) => {
                  const isNavigable = isSessionPageNavigableSandboxStatus(session.status);
                  const sessionTitle = resolveSessionTitleLabel(session.title);

                  return (
                    <TableRow
                      className={
                        isNavigable
                          ? "group/session-row focus-within:bg-muted/50 hover:bg-muted/50"
                          : "group/session-row hover:bg-transparent"
                      }
                      key={session.id}
                      {...(isNavigable ? {} : { "aria-disabled": true })}
                    >
                      <TableCell className="max-w-0 align-top whitespace-normal">
                        <div className="flex min-w-0">
                          <SessionTitleCell
                            title={sessionTitle}
                            {...(isNavigable
                              ? {
                                  href: `/sessions/${encodeURIComponent(session.id)}`,
                                }
                              : {})}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-normal">
                        <span className="break-words text-sm text-foreground/80">
                          {session.sandboxProfileDisplayName ?? session.sandboxProfileId}{" "}
                          {formatCompactSandboxProfileVersion(session.sandboxProfileVersion)}
                        </span>
                      </TableCell>
                      <TableCell className="align-top text-sm whitespace-normal">
                        <span className="break-words text-sm text-foreground/80">
                          {formatStartedByLabel(session.startedBy)}
                        </span>
                      </TableCell>
                      <TableCell className="align-top whitespace-nowrap">
                        <span className="text-muted-foreground text-sm">
                          {formatCompactRelativeOrDate(session.createdAt)}
                        </span>
                      </TableCell>
                      <TableCell className="align-top text-right whitespace-nowrap">
                        <div className="flex justify-end">
                          {resolveUpdatedLabel({
                            status: session.status,
                            updatedAt: session.updatedAt,
                            failureMessage: session.failureMessage,
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="align-middle text-right">
                        <div className="flex justify-end">
                          <SessionRowActions
                            isDisabled={
                              deleteSessionMutation.isPending &&
                              deleteSessionMutation.variables?.id === session.id
                            }
                            onRequestDelete={() => {
                              requestDeleteSession(session);
                            }}
                            sessionTitle={sessionTitle}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        ) : null}

        {canShowSessionList ? (
          <TableListingFooter
            resultsCount={
              sandboxInstancesQuery.data === undefined ? null : (
                <p className="text-muted-foreground text-sm">
                  Showing {sandboxInstancesQuery.data.items.length} of{" "}
                  {sandboxInstancesQuery.data.totalResults}
                </p>
              )
            }
            pagination={
              !hasNextPage && !hasPreviousPage ? null : (
                <TablePagination
                  hasNextPage={hasNextPage}
                  hasPreviousPage={hasPreviousPage}
                  nextPageDisabled={nextPageDisabled}
                  onNextPage={goToNextPage}
                  onPreviousPage={goToPreviousPage}
                  previousPageDisabled={previousPageDisabled}
                />
              )
            }
          />
        ) : null}
      </div>
    </PageFrame>
  );
}
