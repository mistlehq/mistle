import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
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
  metadataLabel: string;
  to: string;
  showActivityIndicator: boolean;
  updatedAt: string;
};

export type SessionsSidebarNavGroup = {
  profileId: string;
  profileName: string;
  items: SessionsSidebarNavItem[];
};

export type SessionsSidebarSearchFilter = {
  searchQuery: string;
};

export function resolveSessionsSidebarShowActivityIndicator(input: {
  status: SessionsSidebarSourceItem["status"];
  keepaliveActive: boolean;
}): boolean | null {
  if (!isSessionPageNavigableSandboxStatus(input.status)) {
    return null;
  }

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

  return formatCompactRelativeOrDate(input.updatedAt, {
    ...(input.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
  });
}

export function buildSessionsSidebarNavGroups(
  groups: readonly SessionsSidebarSourceGroup[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavGroup[] {
  return groups
    .map((group) => ({
      profileId: group.profileId,
      profileName: group.profileName,
      items: group.items.flatMap((item) => {
        const showActivityIndicator = resolveSessionsSidebarShowActivityIndicator({
          status: item.status,
          keepaliveActive: item.keepaliveActive,
        });
        if (showActivityIndicator === null) {
          return [];
        }

        return [
          {
            id: item.id,
            label: resolveSessionTitleLabel(item.title),
            metadataLabel: resolveMetadataLabel({
              status: item.status,
              keepaliveActive: item.keepaliveActive,
              updatedAt: item.updatedAt,
              ...(input?.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
            }),
            to: `/sessions/${encodeURIComponent(item.id)}`,
            showActivityIndicator,
            updatedAt: item.updatedAt,
          },
        ];
      }),
    }))
    .filter((group) => group.items.length > 0);
}

export function filterSessionsSidebarNavGroups(input: {
  groups: readonly SessionsSidebarNavGroup[];
  searchFilter: SessionsSidebarSearchFilter;
}): SessionsSidebarNavGroup[] {
  const normalizedQuery = input.searchFilter.searchQuery.trim().toLocaleLowerCase();

  if (normalizedQuery.length === 0) {
    return [...input.groups];
  }

  return input.groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        return (
          item.label.toLocaleLowerCase().includes(normalizedQuery) ||
          group.profileName.toLocaleLowerCase().includes(normalizedQuery)
        );
      }),
    }))
    .filter((group) => group.items.length > 0);
}
