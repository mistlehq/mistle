import type { ListSandboxInstancesResponse } from "@mistle/data-plane-internal-client";

export type EnrichedListedItem = ListSandboxInstancesResponse["items"][number] & {
  title: string | null;
  sandboxProfileDisplayName: string | null;
  startedBy: ListSandboxInstancesResponse["items"][number]["startedBy"] & {
    name: string | null;
  };
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
