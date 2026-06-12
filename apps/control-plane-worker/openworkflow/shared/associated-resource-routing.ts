import type {
  AssociatedResourceEventRouting,
  AssociatedResourceEventType,
} from "@mistle/integrations-core";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

import { evaluateWebhookPayloadFilter } from "./webhook-payload-filter-evaluator.js";

export function supportsAssociatedResourceEvent(input: {
  eventType: AssociatedResourceEventType;
  payload: Record<string, unknown>;
  resourceKind: string;
  routing: AssociatedResourceEventRouting | null;
}): boolean {
  if (input.routing === null || !input.routing.enabled) {
    return false;
  }

  return input.routing.resources.some((resource) => {
    if (
      resource.resourceKind !== input.resourceKind ||
      !resource.eventTypes.includes(input.eventType)
    ) {
      return false;
    }

    const eventScopedPayloadFilter = resource.payloadFilter?.[input.eventType];
    if (eventScopedPayloadFilter === undefined) {
      return true;
    }

    const filter = parseWebhookPayloadFilter(eventScopedPayloadFilter);
    return evaluateWebhookPayloadFilter({
      filter,
      payload: input.payload,
    });
  });
}
