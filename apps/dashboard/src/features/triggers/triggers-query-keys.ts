import type { ListTriggersQuery } from "./triggers-types.js";

export const TRIGGERS_QUERY_KEY_PREFIX: readonly ["triggers"] = ["triggers"];

type TriggersListQueryKeyInput = Omit<ListTriggersQuery, "after" | "before"> & {
  limit: number;
  after: string | null;
  before: string | null;
};

export function triggersListQueryKey(
  input: TriggersListQueryKeyInput,
): readonly ["triggers", "list", TriggersListQueryKeyInput] {
  return [
    TRIGGERS_QUERY_KEY_PREFIX[0],
    "list",
    {
      limit: input.limit,
      after: input.after,
      before: input.before,
      ...(input.sandboxProfileId === undefined ? {} : { sandboxProfileId: input.sandboxProfileId }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.search === undefined ? {} : { search: input.search }),
    },
  ];
}

export function webhookTriggerDetailQueryKey(
  triggerId: string,
): readonly ["triggers", "webhooks", "detail", string] {
  return [TRIGGERS_QUERY_KEY_PREFIX[0], "webhooks", "detail", triggerId];
}

export function triggerDetailQueryKey(triggerId: string): readonly ["triggers", "detail", string] {
  return [TRIGGERS_QUERY_KEY_PREFIX[0], "detail", triggerId];
}

export function scheduledTriggerDetailQueryKey(
  triggerId: string,
): readonly ["triggers", "schedules", "detail", string] {
  return [TRIGGERS_QUERY_KEY_PREFIX[0], "schedules", "detail", triggerId];
}
