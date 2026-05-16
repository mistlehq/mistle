import {
  Badge,
  Button,
  Notice,
  OverflowTooltipText,
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
import { InfoIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useLaunchableSandboxProfiles } from "../sandbox-profiles/use-launchable-sandbox-profiles.js";
import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import { listSandboxInstances } from "../sessions/sessions-service.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { CollectionEmptyState } from "../shared/collection-empty-state.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import { PageFrame } from "../shared/page-frame.js";
import { readKeysetPaginationCursors } from "../shared/pagination-search-params.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { SessionsRoutes } from "../shell/app-shell-sessions-sidebar-mode.js";
import {
  resolveSandboxStatusBadgeUi,
  type SandboxLifecycleStatus,
} from "./sandbox-status-presentation.js";

const SANDBOX_INSTANCE_LIST_LIMIT = 20;
const SANDBOX_INSTANCE_LIST_MAX_LIMIT = 100;
const SessionTitleTooltipSideOffset = 8;

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

export function SessionsPage(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const sandboxInstanceListLimit = parseListLimit(searchParams.get("limit"));
  const { after: sandboxInstancesAfter, before: sandboxInstancesBefore } =
    readKeysetPaginationCursors(searchParams);

  const sandboxInstancesQuery = useQuery({
    queryKey: sandboxInstancesListQueryKey({
      limit: sandboxInstanceListLimit,
      after: sandboxInstancesAfter,
      before: sandboxInstancesBefore,
    }),
    queryFn: async ({ signal }) =>
      listSandboxInstances({
        limit: sandboxInstanceListLimit,
        after: sandboxInstancesAfter,
        before: sandboxInstancesBefore,
        signal,
      }),
  });
  const displayedSessions = sandboxInstancesQuery.data?.items ?? [];

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

  function goToNextPage(): void {
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

  const isLoadingSessions = sandboxInstancesQuery.isPending;
  const hasNoSessions = sandboxInstancesQuery.data?.totalResults === 0;
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
  const canShowSessionList = sandboxInstancesQuery.data !== undefined && !hasNoSessions;

  const hasNextPage = sandboxInstancesQuery.data?.nextPage != null;
  const hasPreviousPage = sandboxInstancesQuery.data?.previousPage != null;
  const nextPageDisabled = sandboxInstancesQuery.isPending;
  const previousPageDisabled = sandboxInstancesQuery.isPending;
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

        <SessionsEmptyState state={sessionsEmptyState} />

        {canShowSessionList ? (
          <Table className="min-w-[40rem] table-fixed">
            <TableHeader className="bg-muted/60">
              <TableRow className="h-9 border-b">
                <TableHead className="text-foreground w-[36%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                  Sessions
                </TableHead>
                <TableHead className="text-foreground w-[20%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                  Sandbox profile
                </TableHead>
                <TableHead className="text-foreground w-[18%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase">
                  Started by
                </TableHead>
                <TableHead className="text-foreground w-[14%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                  Created
                </TableHead>
                <TableHead className="text-right text-foreground w-[12%] py-2 text-[11px] font-semibold tracking-[0.08em] uppercase whitespace-nowrap">
                  Updated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedSessions.map((session) => {
                const isNavigable = isSessionPageNavigableSandboxStatus(session.status);

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
                          title={resolveSessionTitleLabel(session.title)}
                          {...(isNavigable
                            ? {
                                href: `/sessions/${encodeURIComponent(session.id)}`,
                              }
                            : {})}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="align-top text-sm whitespace-normal">
                      <span className="break-words text-sm text-muted-foreground">
                        {session.sandboxProfileDisplayName ?? session.sandboxProfileId}
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
