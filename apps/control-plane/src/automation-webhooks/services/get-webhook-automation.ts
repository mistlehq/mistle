import { loadWebhookAutomationAggregateOrThrow } from "./shared.js";
import type { CreateAutomationWebhooksServiceInput, GetWebhookAutomationInput } from "./types.js";

export async function getWebhookAutomation(
  input: Pick<CreateAutomationWebhooksServiceInput, "db">,
  serviceInput: GetWebhookAutomationInput,
) {
  return loadWebhookAutomationAggregateOrThrow(input.db, serviceInput);
}
