import { AUTOMATIONS_QUERY_KEY_PREFIX } from "./webhook-automations-query-keys.js";

export function scheduledAutomationDetailQueryKey(
  automationId: string,
): readonly ["automations", "schedules", "detail", string] {
  return [AUTOMATIONS_QUERY_KEY_PREFIX[0], "schedules", "detail", automationId];
}
