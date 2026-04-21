import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { sessionSidebarGroupsQueryKey } from "../sessions/sessions-query-keys.js";
import { listSessionSidebarGroups } from "../sessions/sessions-service.js";
import type { SessionSidebarGroup } from "../sessions/sessions-types.js";
import {
  buildSessionsSidebarNavGroups,
  type SessionsSidebarNavGroup,
  type SessionsSidebarSourceGroup,
} from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

const SESSIONS_SIDEBAR_LIST_LIMIT = 100;

export function buildSessionsShellSidebarGroups(
  groups: readonly SessionSidebarGroup[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavGroup[] {
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

  return buildSessionsSidebarNavGroups(sourceGroups, {
    ...(input?.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
  });
}

export function SessionsShellSidebar(): React.JSX.Element {
  const sandboxInstancesQuery = useQuery({
    queryKey: sessionSidebarGroupsQueryKey({
      limit: SESSIONS_SIDEBAR_LIST_LIMIT,
    }),
    queryFn: async ({ signal }) =>
      listSessionSidebarGroups({
        limit: SESSIONS_SIDEBAR_LIST_LIMIT,
        signal,
      }),
  });
  const groups = buildSessionsShellSidebarGroups(sandboxInstancesQuery.data?.groups ?? []);
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
      <SessionsSidebarNav emptyMessage={emptyMessage} groups={groups} />
      {errorMessage === null ? null : (
        <div className="px-2 pb-2">
          <ErrorNotice message={errorMessage} />
        </div>
      )}
    </>
  );
}
