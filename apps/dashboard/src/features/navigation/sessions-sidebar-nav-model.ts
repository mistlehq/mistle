import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";

export type SidebarSessionItem = {
  id: string;
  title: string | null;
  profileName: string;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  updatedAt: string;
  keepaliveActive: boolean;
};

export type SessionsSidebarNavItem = {
  id: string;
  label: string;
  profileName: string;
  metadataLabel: string;
  to: string;
  showActivityIndicator: boolean;
  updatedAt: string;
};

export type SessionsSidebarSearchFilter = {
  searchQuery: string;
};

export function resolveSessionsSidebarShowActivityIndicator(input: {
  status: SidebarSessionItem["status"];
  keepaliveActive: boolean;
}): boolean {
  return input.status === "running" && input.keepaliveActive;
}

function resolveMetadataLabel(
  input: Pick<SidebarSessionItem, "keepaliveActive" | "status" | "updatedAt"> & {
    nowEpochMs?: number;
  },
): string {
  if (input.status === "running" && input.keepaliveActive) {
    return "Working";
  }

  if (input.status === "running") {
    return "Idle";
  }

  if (input.status === "failed") {
    return "Failed";
  }

  return formatCompactRelativeOrDate(input.updatedAt, {
    ...(input.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
  });
}

export function buildSidebarSessionNavItems(
  items: readonly SidebarSessionItem[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavItem[] {
  return items
    .filter((item) => isSessionPageNavigableSandboxStatus(item.status))
    .map((item) => ({
      id: item.id,
      label: resolveSessionTitleLabel(item.title),
      profileName: item.profileName,
      metadataLabel: resolveMetadataLabel({
        status: item.status,
        keepaliveActive: item.keepaliveActive,
        updatedAt: item.updatedAt,
        ...(input?.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
      }),
      to: `/sessions/${encodeURIComponent(item.id)}`,
      showActivityIndicator: resolveSessionsSidebarShowActivityIndicator({
        status: item.status,
        keepaliveActive: item.keepaliveActive,
      }),
      updatedAt: item.updatedAt,
    }));
}

export function filterSessionsSidebarNavItems(input: {
  items: readonly SessionsSidebarNavItem[];
  searchFilter: SessionsSidebarSearchFilter;
}): SessionsSidebarNavItem[] {
  const normalizedQuery = input.searchFilter.searchQuery.trim().toLocaleLowerCase();

  if (normalizedQuery.length === 0) {
    return [...input.items];
  }

  return input.items.filter((item) => {
    return (
      item.label.toLocaleLowerCase().includes(normalizedQuery) ||
      item.profileName.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
}
