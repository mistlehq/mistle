export const TRIGGERS_QUERY_KEY_PREFIX: readonly ["triggers"] = ["triggers"];

export function triggersListQueryKey(input: {
  limit: number;
  after: string | null;
  before: string | null;
  sandboxProfileId?: string | undefined;
}): readonly ["triggers", "list", number, string | null, string | null, string | undefined] {
  return [
    TRIGGERS_QUERY_KEY_PREFIX[0],
    "list",
    input.limit,
    input.after,
    input.before,
    input.sandboxProfileId,
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
