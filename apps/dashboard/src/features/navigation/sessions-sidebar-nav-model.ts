import { isSessionPageNavigableSandboxStatus } from "../sessions/session-connect-policy.js";

export type SessionsSidebarAttentionState = "active" | "idle" | "setup";

export type SessionsSidebarSourceItem = {
  id: string;
  title: string | null;
  sandboxProfileId: string;
  sandboxProfileDisplayName: string | null;
  status: "pending" | "starting" | "running" | "stopped" | "failed";
  createdAt: string;
  keepaliveActive: boolean;
};

export type SessionsSidebarNavItem = {
  id: string;
  label: string;
  to: string;
  attentionState: SessionsSidebarAttentionState;
};

export type SessionsSidebarNavGroup = {
  profileId: string;
  profileName: string;
  items: SessionsSidebarNavItem[];
};

export type SessionsSidebarSearchFilter = {
  searchQuery: string;
};

export function resolveSessionsSidebarAttentionState(input: {
  status: SessionsSidebarSourceItem["status"];
  keepaliveActive: boolean;
}): SessionsSidebarAttentionState | null {
  if (!isSessionPageNavigableSandboxStatus(input.status)) {
    return null;
  }

  if (input.status === "running") {
    return input.keepaliveActive ? "active" : "idle";
  }

  if (input.status === "stopped") {
    return "idle";
  }

  return "setup";
}

function resolveProfileName(input: SessionsSidebarSourceItem): string {
  return input.sandboxProfileDisplayName ?? input.sandboxProfileId;
}

function resolveInstanceLabel(input: SessionsSidebarSourceItem): string {
  return input.title ?? "Untitled";
}

function resolveAttentionRank(input: SessionsSidebarAttentionState): number {
  if (input === "active") {
    return 0;
  }

  if (input === "idle") {
    return 1;
  }

  return 2;
}

export function buildSessionsSidebarNavGroups(
  items: readonly SessionsSidebarSourceItem[],
): SessionsSidebarNavGroup[] {
  const groupsByProfileId = new Map<string, SessionsSidebarNavGroup>();

  for (const item of items) {
    const attentionState = resolveSessionsSidebarAttentionState({
      status: item.status,
      keepaliveActive: item.keepaliveActive,
    });
    if (attentionState === null) {
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
      label: resolveInstanceLabel(item),
      to: `/sessions/${encodeURIComponent(item.id)}`,
      attentionState,
    });

    if (existingGroup === undefined) {
      groupsByProfileId.set(item.sandboxProfileId, group);
    }
  }

  return [...groupsByProfileId.values()]
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) => {
        const attentionDifference =
          resolveAttentionRank(left.attentionState) - resolveAttentionRank(right.attentionState);
        if (attentionDifference !== 0) {
          return attentionDifference;
        }

        return left.label.localeCompare(right.label);
      }),
    }))
    .sort((left, right) => left.profileName.localeCompare(right.profileName));
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
