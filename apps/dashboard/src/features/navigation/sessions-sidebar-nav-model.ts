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
};

export type SessionsSidebarNavItem = {
  id: string;
  label: string;
  profileName: string;
  status: SessionsSidebarSourceItem["status"];
  updatedAtLabel: string;
  to?: string;
};

export type SessionsSidebarSearchFilter = {
  searchQuery: string;
};

function resolveProfileName(input: SessionsSidebarSourceItem): string {
  return input.sandboxProfileDisplayName ?? input.sandboxProfileId;
}

export function buildSessionsSidebarNavItems(
  items: readonly SessionsSidebarSourceItem[],
  input?: {
    nowEpochMs?: number;
  },
): SessionsSidebarNavItem[] {
  return items.map((item) => ({
    id: item.id,
    label: resolveSessionTitleLabel(item.title),
    profileName: resolveProfileName(item),
    status: item.status,
    updatedAtLabel: formatCompactRelativeOrDate(item.updatedAt, {
      ...(input?.nowEpochMs === undefined ? {} : { nowEpochMs: input.nowEpochMs }),
    }),
    ...(isSessionPageNavigableSandboxStatus(item.status)
      ? { to: `/sessions/${encodeURIComponent(item.id)}` }
      : {}),
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
