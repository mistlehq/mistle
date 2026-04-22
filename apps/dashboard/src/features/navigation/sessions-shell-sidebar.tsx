import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { ErrorNotice } from "../auth/error-notice.js";
import {
  sidebarSessionsFeedQueryKey,
  sidebarSessionsHeadQueryKey,
} from "../sessions/sessions-query-keys.js";
import { listSandboxInstances } from "../sessions/sessions-service.js";
import type {
  SandboxInstanceListItem,
  SandboxInstancesListResult,
  SandboxInstancesNextPageCursor,
} from "../sessions/sessions-types.js";
import {
  buildSidebarSessionNavItems as buildSidebarSessionNavItemsModel,
  type SessionsSidebarNavItem,
  type SidebarSessionItem,
} from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

export const SESSIONS_SIDEBAR_INITIAL_LIMIT = 25;
export const SESSIONS_SIDEBAR_HEAD_CHECK_INTERVAL_MS = 30_000;
export const SESSIONS_SIDEBAR_MAX_AUTO_MERGE_COUNT = 10;

export function buildSidebarSessionItems(
  items: readonly SandboxInstanceListItem[],
): SidebarSessionItem[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    profileName: item.sandboxProfileDisplayName ?? item.sandboxProfileId,
    status: item.status,
    updatedAt: item.updatedAt,
    keepaliveActive: item.keepaliveActive,
  }));
}

export function buildSidebarSessionNavItems(input: {
  items: readonly SandboxInstanceListItem[];
  nowEpochMs?: number;
}): SessionsSidebarNavItem[] {
  return buildSidebarSessionNavItemsModel(buildSidebarSessionItems(input.items), {
    ...(input.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
  });
}

export function flattenSidebarSessionPages(
  pages: readonly SandboxInstancesListResult[],
): SandboxInstanceListItem[] {
  return pages.flatMap((page) => page.items);
}

export function resolveSidebarSessionsHasMore(
  pages: readonly SandboxInstancesListResult[],
): boolean {
  const lastPage = pages.at(-1);
  return lastPage?.nextPage !== null && lastPage?.nextPage !== undefined;
}

export function resolveSidebarSessionsNextCursor(
  pages: readonly SandboxInstancesListResult[],
): SandboxInstancesNextPageCursor | null {
  const lastPage = pages.at(-1);
  return lastPage?.nextPage ?? null;
}

export function dedupeSidebarSessionItems(
  items: readonly SandboxInstanceListItem[],
): SandboxInstanceListItem[] {
  const seenIds = new Set<string>();
  const dedupedItems: SandboxInstanceListItem[] = [];

  for (const item of items) {
    if (seenIds.has(item.id)) {
      continue;
    }

    seenIds.add(item.id);
    dedupedItems.push(item);
  }

  return dedupedItems;
}

export function prependSidebarSessionItems(input: {
  currentItems: readonly SandboxInstanceListItem[];
  newerItems: readonly SandboxInstanceListItem[];
}): SandboxInstanceListItem[] {
  return dedupeSidebarSessionItems([...input.newerItems, ...input.currentItems]);
}

export function filterSidebarPrependedItems(input: {
  prependedItems: readonly SandboxInstanceListItem[];
  baseItems: readonly SandboxInstanceListItem[];
}): SandboxInstanceListItem[] {
  const baseItemIds = new Set(input.baseItems.map((item) => item.id));

  return input.prependedItems.filter((item) => !baseItemIds.has(item.id));
}

export type SidebarHeadRefreshResolution =
  | {
      kind: "noop";
    }
  | {
      kind: "merge";
      items: SandboxInstanceListItem[];
      newerItemCount: number;
    }
  | {
      kind: "refresh";
      newerItemCount: number;
    };

export function resolveSidebarHeadRefresh(input: {
  currentItems: readonly SandboxInstanceListItem[];
  latestHeadItems: readonly SandboxInstanceListItem[];
  maxAutoMergeCount: number;
}): SidebarHeadRefreshResolution {
  if (input.latestHeadItems.length === 0) {
    return {
      kind: "noop",
    };
  }

  if (input.currentItems.length === 0) {
    return {
      kind: "merge",
      items: [...input.latestHeadItems],
      newerItemCount: input.latestHeadItems.length,
    };
  }

  const currentHeadId = input.currentItems[0]?.id;
  const overlapIndex = input.latestHeadItems.findIndex((item) => item.id === currentHeadId);

  if (overlapIndex === 0) {
    return {
      kind: "noop",
    };
  }

  if (overlapIndex === -1 || overlapIndex > input.maxAutoMergeCount) {
    return {
      kind: "refresh",
      newerItemCount: overlapIndex === -1 ? input.latestHeadItems.length : overlapIndex,
    };
  }

  const mergedIds = new Set<string>();
  const mergedItems: SandboxInstanceListItem[] = [];

  for (const item of [...input.latestHeadItems.slice(0, overlapIndex), ...input.currentItems]) {
    if (mergedIds.has(item.id)) {
      continue;
    }
    mergedIds.add(item.id);
    mergedItems.push(item);
  }

  return {
    kind: "merge",
    items: mergedItems,
    newerItemCount: overlapIndex,
  };
}

export function SessionsShellSidebar(): React.JSX.Element {
  const [feedEpoch, setFeedEpoch] = useState(0);
  const [prependedItems, setPrependedItems] = useState<SandboxInstanceListItem[]>([]);
  const [isRefreshingList, setIsRefreshingList] = useState(false);
  const [showRefreshList, setShowRefreshList] = useState(false);
  const sandboxInstancesQuery = useInfiniteQuery({
    initialPageParam: null as SandboxInstancesNextPageCursor | null,
    queryKey: sidebarSessionsFeedQueryKey({
      epoch: feedEpoch,
    }),
    queryFn: async ({ pageParam, signal }) =>
      listSandboxInstances({
        limit: SESSIONS_SIDEBAR_INITIAL_LIMIT,
        after: pageParam?.after ?? null,
        before: null,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
  });
  const headCheckQuery = useQuery({
    queryKey: sidebarSessionsHeadQueryKey({
      epoch: feedEpoch,
    }),
    queryFn: async ({ signal }) =>
      listSandboxInstances({
        limit: SESSIONS_SIDEBAR_INITIAL_LIMIT,
        after: null,
        before: null,
        signal,
      }),
    enabled: !sandboxInstancesQuery.isPending && !sandboxInstancesQuery.isError,
    refetchInterval: SESSIONS_SIDEBAR_HEAD_CHECK_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  const baseItems = flattenSidebarSessionPages(sandboxInstancesQuery.data?.pages ?? []);
  const items = useMemo(
    () => dedupeSidebarSessionItems([...prependedItems, ...baseItems]),
    [baseItems, prependedItems],
  );
  const navItems = buildSidebarSessionNavItems({
    items,
  });
  const hasMore = resolveSidebarSessionsHasMore(sandboxInstancesQuery.data?.pages ?? []);

  useEffect(() => {
    setPrependedItems((currentPrependedItems) =>
      filterSidebarPrependedItems({
        prependedItems: currentPrependedItems,
        baseItems,
      }),
    );
  }, [baseItems]);

  useEffect(() => {
    if (!headCheckQuery.isSuccess) {
      return;
    }

    const resolution = resolveSidebarHeadRefresh({
      currentItems: items,
      latestHeadItems: headCheckQuery.data.items,
      maxAutoMergeCount: SESSIONS_SIDEBAR_MAX_AUTO_MERGE_COUNT,
    });

    if (resolution.kind === "noop") {
      setShowRefreshList(false);
      return;
    }

    if (resolution.kind === "refresh") {
      setShowRefreshList(true);
      return;
    }

    if (resolution.newerItemCount > 0) {
      setPrependedItems((currentPrependedItems) =>
        prependSidebarSessionItems({
          currentItems: currentPrependedItems,
          newerItems: headCheckQuery.data.items.slice(0, resolution.newerItemCount),
        }),
      );
    }
    setShowRefreshList(false);
  }, [headCheckQuery.data, headCheckQuery.isSuccess, items]);

  useEffect(() => {
    if (!isRefreshingList || sandboxInstancesQuery.isPending || sandboxInstancesQuery.isFetching) {
      return;
    }

    setIsRefreshingList(false);
  }, [
    isRefreshingList,
    sandboxInstancesQuery.isFetching,
    sandboxInstancesQuery.isPending,
    sandboxInstancesQuery.dataUpdatedAt,
  ]);

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
        {...(showRefreshList
          ? {
              headRefresh: {
                label: isRefreshingList ? "Refreshing list" : "Refresh list",
                isRefreshing: isRefreshingList,
                onRefresh: () => {
                  setPrependedItems([]);
                  setShowRefreshList(false);
                  setIsRefreshingList(true);
                  setFeedEpoch((currentEpoch) => currentEpoch + 1);
                },
              },
            }
          : {})}
        items={navItems}
        infiniteScroll={{
          hasMore,
          onReachEnd: () => {
            if (sandboxInstancesQuery.isFetchingNextPage || !hasMore) {
              return;
            }

            void sandboxInstancesQuery.fetchNextPage();
          },
          ...(sandboxInstancesQuery.isFetchingNextPage
            ? {
                statusBanner: {
                  kind: "loading" as const,
                  label: "Loading more",
                },
              }
            : {}),
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
