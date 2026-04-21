import type {
  GetSandboxInstanceResponse,
  ListSandboxInstancesResponse,
} from "@mistle/data-plane-internal-client";

export type EnrichedListedItem = ListSandboxInstancesResponse["items"][number] & {
  title: string | null;
  sandboxProfileDisplayName: string | null;
  startedBy: ListSandboxInstancesResponse["items"][number]["startedBy"] & {
    name: string | null;
  };
};

export type SessionSidebarGroup = {
  profileId: string;
  profileName: string;
  items: Array<{
    id: string;
    title: string | null;
    status: NonNullable<GetSandboxInstanceResponse>["status"];
    keepaliveActive: boolean;
    updatedAt: string;
  }>;
};

export function enrichListedItems(input: {
  items: ListSandboxInstancesResponse["items"];
  sandboxProfileDisplayNames: Map<string, string>;
  startedByNames: Map<string, string>;
}): EnrichedListedItem[] {
  return input.items.map((item) => ({
    ...item,
    title: item.title,
    keepaliveActive: item.keepaliveActive,
    sandboxProfileDisplayName: input.sandboxProfileDisplayNames.get(item.sandboxProfileId) ?? null,
    startedBy: {
      ...item.startedBy,
      name: input.startedByNames.get(item.startedBy.id) ?? null,
    },
  }));
}

export function buildSessionSidebarGroups(
  items: readonly EnrichedListedItem[],
): SessionSidebarGroup[] {
  const groupsByProfileId = new Map<SessionSidebarGroup["profileId"], SessionSidebarGroup>();

  for (const item of items) {
    const existingGroup = groupsByProfileId.get(item.sandboxProfileId);
    const group =
      existingGroup ??
      ({
        profileId: item.sandboxProfileId,
        profileName: item.sandboxProfileDisplayName ?? item.sandboxProfileId,
        items: [],
      } satisfies SessionSidebarGroup);

    group.items.push({
      id: item.id,
      title: item.title,
      status: item.status,
      keepaliveActive: item.keepaliveActive,
      updatedAt: item.updatedAt,
    });

    if (existingGroup === undefined) {
      groupsByProfileId.set(item.sandboxProfileId, group);
    }
  }

  return [...groupsByProfileId.values()];
}
