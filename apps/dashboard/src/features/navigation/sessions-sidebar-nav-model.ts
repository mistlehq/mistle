import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";
import { resolveSessionTitleLabel } from "../sessions/session-title-presentation.js";
import { formatCompactRelativeOrDate } from "../shared/date-formatters.js";

export type SessionsSidebarSourceItem = {
  id: string;
  title: string | null;
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  createdAt: string;
  updatedAt: string;
  keepaliveActive: boolean;
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

function resolveProfileName(input: SessionsSidebarSourceItem): string {
  return input.sandboxProfileDisplayName ?? input.sandboxProfileId;
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

function compareUpdatedAtDescending(
  left: { updatedAt: string },
  right: { updatedAt: string },
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

export function buildSessionsSidebarNavGroups(
  items: readonly SessionsSidebarSourceItem[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavGroup[] {
  const groupsByProfileId = new Map<string, SessionsSidebarNavGroup>();

  for (const item of items) {
    const showActivityIndicator = resolveSessionsSidebarShowActivityIndicator({
      status: item.status,
      keepaliveActive: item.keepaliveActive,
    });
    if (showActivityIndicator === null) {
      continue;
    }

    const existingGroup = groupsByProfileId.get(item.sandboxProfileId);
    const group =
      existingGroup ??
      ({
        profileId: item.sandboxProfileId,
        profileName: resolveProfileName(item),
        items: [],
      } satisfies SessionsSidebarNavGroup);

    group.items.push({
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
    });

    if (existingGroup === undefined) {
      groupsByProfileId.set(item.sandboxProfileId, group);
    }
  }

  return [...groupsByProfileId.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => {
        const updatedAtDifference = compareUpdatedAtDescending(left, right);
        if (updatedAtDifference !== 0) {
          return updatedAtDifference;
        }

        return left.label.localeCompare(right.label);
      }),
    }))
    .sort((left, right) => {
      const leftNewestItem = left.items[0];
      const rightNewestItem = right.items[0];

      if (leftNewestItem !== undefined && rightNewestItem !== undefined) {
        const updatedAtDifference = compareUpdatedAtDescending(leftNewestItem, rightNewestItem);
        if (updatedAtDifference !== 0) {
          return updatedAtDifference;
        }
      }

      return left.profileName.localeCompare(right.profileName);
    });
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
