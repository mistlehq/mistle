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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextLink,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { InfoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { LaunchableSandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import { useLaunchableSandboxProfiles } from "../sandbox-profiles/use-launchable-sandbox-profiles.js";
import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import { listSandboxInstances } from "../sessions/sessions-service.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { useSandboxSessionLaunchState } from "../sessions/use-sandbox-session-launch-state.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";
import { TableListingFooter } from "../shared/table-listing-footer.js";
import { TablePagination } from "../shared/table-pagination.js";
import { resolveUserDisplayName } from "../shared/user-display-name.js";
import { useCachedRequiredSession } from "../shell/session-context.js";
import {
  resolveSandboxStatusBadgeUi,
  type SandboxLifecycleStatus,
} from "./sandbox-status-presentation.js";

const SANDBOX_INSTANCE_LIST_LIMIT = 20;
const SANDBOX_INSTANCE_LIST_MAX_LIMIT = 100;
const SessionTitleTooltipSideOffset = 8;

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

function parseCursor(rawValue: string | null): string | null {
  if (rawValue === null) {
    return null;
  }

  const normalized = rawValue.trim();
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

export function shouldClearSelectedProfile(input: {
  selectedProfile: LaunchableSandboxProfile | null;
  selectableProfiles: readonly LaunchableSandboxProfile[];
  isSelectableProfilesPending: boolean;
}): boolean {
  if (input.selectedProfile === null || input.isSelectableProfilesPending) {
    return false;
  }

  const selectedProfileId = input.selectedProfile.id;

  return !input.selectableProfiles.some((profile) => profile.id === selectedProfileId);
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

export function buildOptimisticSessions(input: {
  launchedSessions: readonly {
    profileId: string;
    profileDisplayName: string;
    profileVersion: number;
    sandboxInstanceId: string;
    createdAtIso: string;
    status: SandboxLifecycleStatus;
    failureCode: string | null;
    failureMessage: string | null;
  }[];
  listedItems: readonly SandboxInstanceListItem[];
  currentUserId: string;
  currentUserDisplayName: string;
}): SandboxInstanceListItem[] {
  const listedInstanceIds = new Set(input.listedItems.map((item) => item.id));
  const items: SandboxInstanceListItem[] = [];

  for (const session of input.launchedSessions) {
    if (listedInstanceIds.has(session.sandboxInstanceId)) {
      continue;
    }

    items.push({
      id: session.sandboxInstanceId,
      title: null,
      sandboxProfileId: session.profileId,
      sandboxProfileDisplayName: session.profileDisplayName,
      sandboxProfileVersion: session.profileVersion,
      status: session.status,
      keepaliveActive: false,
      startedBy: {
        kind: "user",
        id: input.currentUserId,
        name: input.currentUserDisplayName,
      },
      source: "dashboard",
      createdAt: session.createdAtIso,
      updatedAt: session.createdAtIso,
      failureCode: session.failureCode,
      failureMessage: session.failureMessage,
    });
  }

  return items;
}

export function resolveSessionResultsSummary(input: {
  listedSessionCount: number;
  totalResults: number;
  optimisticSessionCount: number;
}): {
  visibleCount: number;
  totalCount: number;
} {
  const visibleCount = input.listedSessionCount + input.optimisticSessionCount;

  return {
    visibleCount,
    totalCount: input.totalResults + input.optimisticSessionCount,
  };
}

export function SessionsPage(): React.JSX.Element {
  const session = useCachedRequiredSession();
  const [searchParams, setSearchParams] = useSearchParams();
  // Tradeoff: the selection intentionally snapshots the launchable profile, including activeVersion.
  // This can lag behind a later refetch, but we prefer starting the exact version the picker
  // validated at selection time over silently changing the selected launch target after selection.
  const [selectedProfile, setSelectedProfile] = useState<LaunchableSandboxProfile | null>(null);
  const {
    launchedSessions,
    startErrorMessage,
    isStartingSession,
    startSession,
    clearStartErrorMessage,
  } = useSandboxSessionLaunchState();
  const sandboxInstanceListLimit = parseListLimit(searchParams.get("limit"));
  const sandboxInstancesAfter = parseCursor(searchParams.get("after"));
  const sandboxInstancesBefore =
    sandboxInstancesAfter === null ? parseCursor(searchParams.get("before")) : null;

  const selectableProfilesQuery = useLaunchableSandboxProfiles();
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
  const selectableProfiles = selectableProfilesQuery.data?.items ?? [];
  const selectedProfileVersion = selectedProfile?.activeVersion ?? null;

  useEffect(() => {
    if (
      shouldClearSelectedProfile({
        selectedProfile,
        selectableProfiles,
        isSelectableProfilesPending: selectableProfilesQuery.isPending,
      })
    ) {
      clearStartErrorMessage();
      setSelectedProfile(null);
    }
  }, [
    clearStartErrorMessage,
    selectableProfiles,
    selectableProfilesQuery.isPending,
    selectedProfile,
  ]);

  const selectedProfileDisplayText =
    selectedProfile === null ? "Select sandbox profile" : selectedProfile.displayName;
  const selectedProfileSelectValue = selectedProfile?.id ?? "";

  const canStartSession =
    selectedProfile !== null &&
    selectedProfileVersion !== null &&
    !selectableProfilesQuery.isPending &&
    !isStartingSession;
  const currentUserDisplayName = resolveUserDisplayName(session.user);
  const optimisticSessions = buildOptimisticSessions({
    launchedSessions,
    listedItems: sandboxInstancesQuery.data?.items ?? [],
    currentUserId: session.user.id,
    currentUserDisplayName,
  });
  const displayedSessions = [...optimisticSessions, ...(sandboxInstancesQuery.data?.items ?? [])];

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

  const hasSessions = displayedSessions.length > 0;

  const listErrorMessage = sandboxInstancesQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxInstancesQuery.error,
        fallbackMessage: "Could not load sandbox instances.",
      })
    : null;

  const isLoadingSessions = sandboxInstancesQuery.isPending && optimisticSessions.length === 0;

  const hasNextPage = sandboxInstancesQuery.data?.nextPage != null;
  const hasPreviousPage = sandboxInstancesQuery.data?.previousPage != null;
  const nextPageDisabled = sandboxInstancesQuery.isPending;
  const previousPageDisabled = sandboxInstancesQuery.isPending;
  const sessionResultsSummary =
    sandboxInstancesQuery.data === undefined
      ? null
      : resolveSessionResultsSummary({
          listedSessionCount: sandboxInstancesQuery.data.items.length,
          totalResults: sandboxInstancesQuery.data.totalResults,
          optimisticSessionCount: optimisticSessions.length,
        });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Start a new session</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={selectableProfilesQuery.isPending || selectableProfiles.length === 0}
            onValueChange={(value) => {
              clearStartErrorMessage();
              if (value === null || value.length === 0) {
                setSelectedProfile(null);
                return;
              }
              setSelectedProfile(
                selectableProfiles.find((profile) => profile.id === value) ?? null,
              );
            }}
            value={selectedProfileSelectValue}
          >
            <SelectTrigger
              aria-label="Sandbox profile"
              className="min-w-56"
              id="session-start-profile"
            >
              <SelectValue placeholder="Select sandbox profile">
                {selectedProfileDisplayText}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {selectableProfiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!canStartSession}
            onClick={() => {
              if (!canStartSession) {
                return;
              }

              if (selectedProfile === null || selectedProfileVersion === null) {
                return;
              }

              startSession({
                profileId: selectedProfile.id,
                profileDisplayName: selectedProfileDisplayText,
                profileVersion: selectedProfileVersion,
              });
            }}
            type="button"
          >
            {isStartingSession ? "Starting sandbox..." : "Start session"}
          </Button>
        </div>

        {selectableProfilesQuery.isError ? (
          <Notice title="Could not load sandbox profiles" variant="alert">
            {resolveApiErrorMessage({
              error: selectableProfilesQuery.error,
              fallbackMessage: "Could not load sandbox profiles.",
            })}
          </Notice>
        ) : null}
        {startErrorMessage === null ? null : (
          <Notice title="Session start failed" variant="alert">
            {startErrorMessage}
          </Notice>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {listErrorMessage === null ? null : (
          <Notice title="Could not load sandbox instances" variant="alert">
            {listErrorMessage}
          </Notice>
        )}

        <div className="flex flex-col gap-3">
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
              {!isLoadingSessions && !hasSessions ? (
                <TableRow>
                  <TableCell className="text-muted-foreground" colSpan={5}>
                    No sessions yet.
                  </TableCell>
                </TableRow>
              ) : (
                displayedSessions.map((session) => {
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
                })
              )}
            </TableBody>
          </Table>

          <TableListingFooter
            resultsCount={
              sessionResultsSummary === null ? null : (
                <p className="text-muted-foreground text-sm">
                  Showing {sessionResultsSummary.visibleCount} of {sessionResultsSummary.totalCount}
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
        </div>
      </div>
    </div>
  );
}
