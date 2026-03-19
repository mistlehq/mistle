import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
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
} from "@mistle/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  sandboxProfileVersionIntegrationBindingsQueryKey,
  sandboxProfilesListQueryKey,
  sandboxProfileVersionsQueryKey,
} from "../sandbox-profiles/sandbox-profiles-query-keys.js";
import {
  getSandboxProfileVersionIntegrationBindings,
  listSandboxProfiles,
  listSandboxProfileVersions,
} from "../sandbox-profiles/sandbox-profiles-service.js";
import { isConnectableSandboxStatus } from "../sessions/session-connect-policy.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import { listSandboxInstances } from "../sessions/sessions-service.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import { useSandboxSessionLaunchState } from "../sessions/use-sandbox-session-launch-state.js";
import { formatDateTime } from "../shared/date-formatters.js";

const SANDBOX_PROFILE_LIST_LIMIT = 100;
const SANDBOX_INSTANCE_LIST_LIMIT = 20;
const SANDBOX_INSTANCE_LIST_MAX_LIMIT = 100;

type SandboxSessionStatus = "starting" | "running" | "stopped" | "failed";

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

function resolveLatestVersion(versions: readonly { version: number }[]): number | null {
  if (versions.length === 0) {
    return null;
  }

  let latestVersion = versions[0]?.version;
  if (latestVersion === undefined) {
    return null;
  }

  for (const candidate of versions) {
    if (candidate.version > latestVersion) {
      latestVersion = candidate.version;
    }
  }

  return latestVersion;
}

function getSandboxSessionStatusBadgeUi(status: SandboxSessionStatus): {
  label: string;
  variant: "secondary" | "outline" | "destructive";
  className?: string;
} {
  if (status === "running") {
    return {
      label: "Running",
      variant: "secondary",
      className: "bg-emerald-600 text-white hover:bg-emerald-600/90",
    };
  }

  if (status === "failed") {
    return {
      label: "Failed",
      variant: "destructive",
    };
  }

  if (status === "stopped") {
    return {
      label: "Stopped",
      variant: "outline",
    };
  }

  return {
    label: "Starting",
    variant: "outline",
  };
}

export function SessionsPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
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

  const profilesQuery = useQuery({
    queryKey: sandboxProfilesListQueryKey({
      limit: SANDBOX_PROFILE_LIST_LIMIT,
      after: null,
      before: null,
    }),
    queryFn: async ({ signal }) =>
      listSandboxProfiles({
        limit: SANDBOX_PROFILE_LIST_LIMIT,
        after: null,
        before: null,
        signal,
      }),
  });
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
  const versionsQuery = useQuery({
    queryKey:
      selectedProfileId === null
        ? sandboxProfileVersionsQueryKey("none")
        : sandboxProfileVersionsQueryKey(selectedProfileId),
    queryFn: async ({ signal }) => {
      if (selectedProfileId === null) {
        return { versions: [] };
      }
      return listSandboxProfileVersions({
        profileId: selectedProfileId,
        signal,
      });
    },
    enabled: selectedProfileId !== null,
    retry: false,
  });

  const selectedProfileVersion = useMemo(
    () => resolveLatestVersion(versionsQuery.data?.versions ?? []),
    [versionsQuery.data?.versions],
  );
  const integrationBindingsQuery = useQuery({
    queryKey:
      selectedProfileId === null || selectedProfileVersion === null
        ? sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: "none",
            version: 0,
          })
        : sandboxProfileVersionIntegrationBindingsQueryKey({
            profileId: selectedProfileId,
            version: selectedProfileVersion,
          }),
    queryFn: async ({ signal }) => {
      if (selectedProfileId === null || selectedProfileVersion === null) {
        return { bindings: [] };
      }

      return getSandboxProfileVersionIntegrationBindings({
        profileId: selectedProfileId,
        version: selectedProfileVersion,
        signal,
      });
    },
    enabled: selectedProfileId !== null && selectedProfileVersion !== null,
    retry: false,
  });
  const hasAgentBinding = (integrationBindingsQuery.data?.bindings ?? []).some(
    (binding) => binding.kind === "agent",
  );

  const selectedProfileDisplayText =
    selectedProfileId === null
      ? "Select sandbox profile"
      : (profilesQuery.data?.items.find((profile) => profile.id === selectedProfileId)
          ?.displayName ?? "Select sandbox profile");
  const selectedProfileSelectValue = selectedProfileId ?? "";

  const canStartSession =
    selectedProfileId !== null &&
    selectedProfileVersion !== null &&
    !profilesQuery.isPending &&
    !versionsQuery.isPending &&
    !integrationBindingsQuery.isPending &&
    !integrationBindingsQuery.isError &&
    hasAgentBinding &&
    !isStartingSession;
  const profilesById = useMemo(
    () =>
      new Map(
        (profilesQuery.data?.items ?? []).map((profile) => [profile.id, profile.displayName]),
      ),
    [profilesQuery.data?.items],
  );
  const optimisticSessions = useMemo(() => {
    const listedInstanceIds = new Set(
      (sandboxInstancesQuery.data?.items ?? []).map((item) => item.id),
    );
    const items: SandboxInstanceListItem[] = [];

    for (const session of launchedSessions) {
      if (listedInstanceIds.has(session.sandboxInstanceId)) {
        continue;
      }

      items.push({
        id: session.sandboxInstanceId,
        sandboxProfileId: session.profileId,
        sandboxProfileVersion: session.profileVersion,
        status: session.status,
        startedBy: {
          kind: "user",
          id: "current-user",
          name: null,
        },
        source: "dashboard",
        createdAt: session.createdAtIso,
        updatedAt: session.createdAtIso,
        failureCode: session.failureCode,
        failureMessage: session.failureMessage,
      });
    }

    return items;
  }, [launchedSessions, sandboxInstancesQuery.data?.items]);
  const displayedSessions = useMemo(() => {
    const combinedItems = [...optimisticSessions, ...(sandboxInstancesQuery.data?.items ?? [])];

    return combinedItems.sort((left, right) => {
      const statusRank: Record<SandboxSessionStatus, number> = {
        starting: 0,
        running: 1,
        failed: 2,
        stopped: 3,
      };

      const rankDifference = statusRank[left.status] - statusRank[right.status];
      if (rankDifference !== 0) {
        return rankDifference;
      }

      return Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
  }, [optimisticSessions, sandboxInstancesQuery.data?.items]);

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

  function resolveProfileDisplayName(profileId: string): string {
    return profilesById.get(profileId) ?? profileId;
  }

  function formatStartedByLabel(input: SandboxInstanceListItem["startedBy"]): string {
    if (input.kind === "user" && input.name !== null) {
      return input.name;
    }

    if (input.kind === "system") {
      return "System";
    }

    return "User";
  }

  const sortedSessions = displayedSessions;

  const hasSessions = sortedSessions.length > 0;

  const listErrorMessage = sandboxInstancesQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxInstancesQuery.error,
        fallbackMessage: "Could not load sandbox instances.",
      })
    : null;

  const isLoadingSessions = sandboxInstancesQuery.isPending && optimisticSessions.length === 0;

  const nextPageDisabled =
    sandboxInstancesQuery.isPending || sandboxInstancesQuery.data?.nextPage === null;
  const previousPageDisabled =
    sandboxInstancesQuery.isPending || sandboxInstancesQuery.data?.previousPage === null;

  const hasPagination =
    sandboxInstancesQuery.data?.nextPage !== null ||
    sandboxInstancesQuery.data?.previousPage !== null;

  const optimisticSessionIds = new Set(optimisticSessions.map((session) => session.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Start a new session</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            disabled={profilesQuery.isPending || (profilesQuery.data?.items.length ?? 0) === 0}
            onValueChange={(value) => {
              clearStartErrorMessage();
              if (value === null || value.length === 0) {
                setSelectedProfileId(null);
                return;
              }
              setSelectedProfileId(value);
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
              {(profilesQuery.data?.items ?? []).map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!canStartSession}
            onClick={() => {
              if (selectedProfileId === null || selectedProfileVersion === null) {
                return;
              }

              startSession({
                profileId: selectedProfileId,
                profileDisplayName: selectedProfileDisplayText,
                profileVersion: selectedProfileVersion,
              });
            }}
            type="button"
          >
            {isStartingSession ? "Starting sandbox..." : "Start session"}
          </Button>
        </div>

        {profilesQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load sandbox profiles</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: profilesQuery.error,
                fallbackMessage: "Could not load sandbox profiles.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {versionsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not resolve sandbox profile version</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: versionsQuery.error,
                fallbackMessage: "Could not load sandbox profile versions.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {integrationBindingsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load integration bindings</AlertTitle>
            <AlertDescription>
              {resolveApiErrorMessage({
                error: integrationBindingsQuery.error,
                fallbackMessage: "Could not load sandbox profile integration bindings.",
              })}
            </AlertDescription>
          </Alert>
        ) : null}
        {selectedProfileId !== null &&
        selectedProfileVersion !== null &&
        !integrationBindingsQuery.isPending &&
        !integrationBindingsQuery.isError &&
        !hasAgentBinding ? (
          <Alert variant="destructive">
            <AlertTitle>Agent Binding Required</AlertTitle>
            <AlertDescription>
              Add an agent integration binding to this sandbox profile version before starting a
              session.
            </AlertDescription>
          </Alert>
        ) : null}
        {startErrorMessage === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>Session start failed</AlertTitle>
            <AlertDescription>{startErrorMessage}</AlertDescription>
          </Alert>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {listErrorMessage === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>Could not load sandbox instances</AlertTitle>
            <AlertDescription>{listErrorMessage}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[72rem] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[31%]">Instance</TableHead>
                  <TableHead className="w-[11%]">Status</TableHead>
                  <TableHead className="w-[16%]">Profile</TableHead>
                  <TableHead className="w-[13%]">Started by</TableHead>
                  <TableHead className="w-[17%]">Created</TableHead>
                  <TableHead className="w-[12%] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingSessions ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      Loading sandbox instances...
                    </TableCell>
                  </TableRow>
                ) : !hasSessions ? (
                  <TableRow>
                    <TableCell className="text-muted-foreground" colSpan={6}>
                      No sandbox instances yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedSessions.map((session) => {
                    const statusUi = getSandboxSessionStatusBadgeUi(session.status);

                    return (
                      <TableRow key={session.id}>
                        <TableCell className="max-w-64">
                          <div className="flex flex-col gap-1">
                            <span className="break-all font-mono text-xs">{session.id}</span>
                            {session.failureMessage === null ? null : (
                              <span className="text-destructive whitespace-pre-wrap text-xs">
                                {session.failureMessage}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={statusUi.className} variant={statusUi.variant}>
                            {statusUi.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="font-medium">
                              {resolveProfileDisplayName(session.sandboxProfileId)}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              v{String(session.sandboxProfileVersion)}
                              {optimisticSessionIds.has(session.id) ? " • Launching locally" : ""}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="flex flex-col gap-1">
                            <span>{formatStartedByLabel(session.startedBy)}</span>
                            <span className="text-muted-foreground text-xs capitalize">
                              {session.source}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDateTime(session.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            disabled={!isConnectableSandboxStatus(session.status)}
                            onClick={() => {
                              navigate(`/sessions/${encodeURIComponent(session.id)}`);
                            }}
                            type="button"
                          >
                            Open session
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {!hasPagination ? null : (
            <div className="flex items-center justify-end gap-2">
              <Button disabled={previousPageDisabled} onClick={goToPreviousPage} type="button">
                Previous
              </Button>
              <Button disabled={nextPageDisabled} onClick={goToNextPage} type="button">
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
