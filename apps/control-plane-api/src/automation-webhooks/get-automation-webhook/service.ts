import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { loadWebhookAutomationAggregateOrThrow } from "../shared.js";
import type { GetWebhookAutomationInput } from "../types.js";

export async function getAutomationWebhook(
  input: { db: ControlPlaneDatabase },
  serviceInput: GetWebhookAutomationInput,
) {
  return loadWebhookAutomationAggregateOrThrow(input.db, serviceInput);
}
