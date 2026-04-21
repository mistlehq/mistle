import { useInfiniteQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { sidebarSessionsQueryKey } from "../sessions/sessions-query-keys.js";
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

export function SessionsShellSidebar(): React.JSX.Element {
  const sandboxInstancesQuery = useInfiniteQuery({
    initialPageParam: null as SandboxInstancesNextPageCursor | null,
    queryKey: sidebarSessionsQueryKey(),
    queryFn: async ({ pageParam, signal }) =>
      listSandboxInstances({
        limit: SESSIONS_SIDEBAR_INITIAL_LIMIT,
        after: pageParam?.after ?? null,
        before: null,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
  });

  const items = flattenSidebarSessionPages(sandboxInstancesQuery.data?.pages ?? []);
  const navItems = buildSidebarSessionNavItems({
    items,
  });
  const hasMore = resolveSidebarSessionsHasMore(sandboxInstancesQuery.data?.pages ?? []);

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
