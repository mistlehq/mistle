import { useQuery } from "@tanstack/react-query";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { ErrorNotice } from "../auth/error-notice.js";
import { sandboxInstancesListQueryKey } from "../sessions/sessions-query-keys.js";
import { listSandboxInstances } from "../sessions/sessions-service.js";
import type { SandboxInstanceListItem } from "../sessions/sessions-types.js";
import {
  buildSessionsSidebarNavItems,
  type SessionsSidebarNavItem,
  type SessionsSidebarSourceItem,
} from "./sessions-sidebar-nav-model.js";
import { SessionsSidebarNav } from "./sessions-sidebar-nav.js";

const SESSIONS_SIDEBAR_LIST_LIMIT = 100;

export function buildSessionsShellSidebarItems(
  items: readonly SandboxInstanceListItem[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavItem[] {
  const sourceItems: SessionsSidebarSourceItem[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    sandboxProfileId: item.sandboxProfileId,
    sandboxProfileDisplayName: item.sandboxProfileDisplayName,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    keepaliveActive: item.keepaliveActive,
  }));

  return buildSessionsSidebarNavItems(sourceItems, {
    ...(input?.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
  });
}

export function SessionsShellSidebar(): React.JSX.Element {
  const sandboxInstancesQuery = useQuery({
    queryKey: sandboxInstancesListQueryKey({
      limit: SESSIONS_SIDEBAR_LIST_LIMIT,
      after: null,
      before: null,
    }),
    queryFn: async ({ signal }) =>
      listSandboxInstances({
        limit: SESSIONS_SIDEBAR_LIST_LIMIT,
        after: null,
        before: null,
        signal,
      }),
  });
  const items = buildSessionsShellSidebarItems(sandboxInstancesQuery.data?.items ?? []);
  const errorMessage = sandboxInstancesQuery.isError
    ? resolveApiErrorMessage({
        error: sandboxInstancesQuery.error,
        fallbackMessage: "Could not load sandbox instances.",
      })
    : null;
  const emptyMessage = sandboxInstancesQuery.isPending ? "Loading sessions..." : "No sessions yet.";

  return (
    <>
      <SessionsSidebarNav emptyMessage={emptyMessage} items={items} />
      {errorMessage === null ? null : (
        <div className="px-2 pb-2">
          <ErrorNotice message={errorMessage} />
        </div>
      )}
    </>
  );
}
