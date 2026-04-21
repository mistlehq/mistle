import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";

export type SessionsSidebarSourceItem = {
  id: string;
  title: string | null;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  updatedAt: string;
  keepaliveActive: boolean;
};

export type SessionsSidebarSourceGroup = {
  profileId: string;
  profileName: string;
  items: SessionsSidebarSourceItem[];
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
  status: SessionsSidebarSourceItem["status"];
  keepaliveActive: boolean;
}): boolean {
  return input.status === "running" && input.keepaliveActive;
}

function resolveMetadataLabel(
  input: Pick<SessionsSidebarSourceItem, "keepaliveActive" | "status" | "updatedAt"> & {
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

export function buildSessionsSidebarNavItems(
  groups: readonly SessionsSidebarSourceGroup[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavItem[] {
  return groups
    .flatMap((group) =>
      group.items.map((item) => ({
        id: item.id,
        label: resolveSessionTitleLabel(item.title),
        profileName: group.profileName,
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
      })),
    )
    .sort((left, right) => {
      const updatedAtDifference = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);

      if (updatedAtDifference !== 0) {
        return updatedAtDifference;
      }

      return left.id.localeCompare(right.id);
    });
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
