export const AUTOMATIONS_QUERY_KEY_PREFIX: readonly ["automations"] = ["automations"];

export function webhookAutomationsListQueryKey(input: {
  limit: number;
  after: string | null;
  before: string | null;
}): readonly ["automations", "webhooks", "list", number, string | null, string | null] {
  return [
    AUTOMATIONS_QUERY_KEY_PREFIX[0],
    "webhooks",
    "list",
    input.limit,
    input.after,
    input.before,
  ];
}

export function webhookAutomationDetailQueryKey(
  automationId: string,
): readonly ["automations", "webhooks", "detail", string] {
  return [AUTOMATIONS_QUERY_KEY_PREFIX[0], "webhooks", "detail", automationId];
}
