import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { sessionSidebarGroupsQueryKey } from "../sessions/sessions-query-keys.js";
import { listSessionSidebarGroups } from "../sessions/sessions-service.js";
import type {
  SessionSidebarGroup,
  SessionSidebarGroupsResult,
} from "../sessions/sessions-types.js";
import {
  buildSessionsSidebarNavItems,
  type SessionsSidebarNavItem,
  type SessionsSidebarSourceGroup,
} from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

export const SESSIONS_SIDEBAR_INITIAL_LIMIT = 30;
const SESSIONS_SIDEBAR_LIMIT_INCREMENT = 30;

export function buildSessionsShellSidebarItems(
  groups: readonly SessionSidebarGroup[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavItem[] {
  const sourceGroups: SessionsSidebarSourceGroup[] = groups.map((group) => ({
    profileId: group.profileId,
    profileName: group.profileName,
    items: group.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      updatedAt: item.updatedAt,
      keepaliveActive: item.keepaliveActive,
    })),
  }));

  return buildSessionsSidebarNavItems(sourceGroups, {
    ...(input?.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
  });
}

export function resolveSessionsShellSidebarHasMore(input: {
  itemCount: number;
  resolvedLimit: number;
}): boolean {
  return input.itemCount >= input.resolvedLimit;
}

export function SessionsShellSidebar(): React.JSX.Element {
  const [requestedLimit, setRequestedLimit] = useState(SESSIONS_SIDEBAR_INITIAL_LIMIT);
  const [resolvedLimit, setResolvedLimit] = useState(SESSIONS_SIDEBAR_INITIAL_LIMIT);
  const [infiniteScrollStatusBanner, setInfiniteScrollStatusBanner] = useState<
    | {
        kind: "loading";
        label: string;
      }
    | undefined
  >(undefined);
  const sandboxInstancesQuery = useQuery<SessionSidebarGroupsResult>({
    queryKey: sessionSidebarGroupsQueryKey({
      limit: requestedLimit,
    }),
    placeholderData: (previousData) => previousData,
    queryFn: async ({ signal }) =>
      listSessionSidebarGroups({
        limit: requestedLimit,
        signal,
      }),
  });
  const items = buildSessionsShellSidebarItems(sandboxInstancesQuery.data?.groups ?? []);
  const hasMore = resolveSessionsShellSidebarHasMore({
    itemCount: items.length,
    resolvedLimit,
  });
  const handleReachEnd = useCallback(() => {
    if (sandboxInstancesQuery.isFetching || !hasMore) {
      return;
    }

    setInfiniteScrollStatusBanner({
      kind: "loading",
      label: "Loading more",
    });
    setRequestedLimit((currentLimit) => currentLimit + SESSIONS_SIDEBAR_LIMIT_INCREMENT);
  }, [hasMore, sandboxInstancesQuery.isFetching]);

  useEffect(() => {
    if (sandboxInstancesQuery.data === undefined || sandboxInstancesQuery.isFetching) {
      return;
    }

    setResolvedLimit(requestedLimit);
  }, [requestedLimit, sandboxInstancesQuery.data, sandboxInstancesQuery.isFetching]);

  useEffect(() => {
    if (infiniteScrollStatusBanner?.kind !== "loading" || sandboxInstancesQuery.isFetching) {
      return;
    }

    setInfiniteScrollStatusBanner(undefined);
  }, [infiniteScrollStatusBanner, sandboxInstancesQuery.isFetching]);

  const errorMessage = sandboxInstancesQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxInstancesQuery.error,
        fallbackMessage: "Could not load sandbox instances.",
      })
    : null;
  const emptyMessage = sandboxInstancesQuery.isPending
    ? "Loading sessions..."
    : "No openable sessions yet.";

  return (
    <>
      <SessionsSidebarNav
        emptyMessage={emptyMessage}
        items={items}
        infiniteScroll={{
          hasMore,
          onReachEnd: handleReachEnd,
          ...(infiniteScrollStatusBanner === undefined
            ? {}
            : { statusBanner: infiniteScrollStatusBanner }),
        }}
      />
      {errorMessage === null ? null : (
        <div className="px-2 pb-2">
          <ErrorNotice message={errorMessage} />
        </div>
      )}
    </>
  );
}
