import type {
  AssociatedResourceEventRouting,
  AssociatedResourceEventType,
  IntegrationAssociatedResourceEventsCapability,
} from "@mistle/integrations-core";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

import { evaluateWebhookPayloadFilter } from "./webhook-payload-filter-evaluator.js";

export async function supportsAssociatedResourceEvent(input: {
  capability: IntegrationAssociatedResourceEventsCapability;
  eventType: AssociatedResourceEventType;
  payload: Record<string, unknown>;
  resourceKind: string;
  routing: AssociatedResourceEventRouting | null;
  sourceWebhookEventType: string;
}): Promise<boolean> {
  if (input.routing === null || !input.routing.enabled) {
    return false;
  }

  for (const resource of input.routing.resources) {
    if (resource.resourceKind !== input.resourceKind) {
      continue;
    }

    if (
      input.capability.supportsRoutingEvent !== undefined &&
      !(await input.capability.supportsRoutingEvent({
        eventType: input.eventType,
        payload: input.payload,
        resource,
        sourceWebhookEventType: input.sourceWebhookEventType,
      }))
    ) {
      continue;
    }

    if (!resource.eventTypes.includes(input.eventType)) {
      continue;
    }

    if (
      payloadFilterAllowsAssociatedResourceEvent({
        payload: input.payload,
        eventScopedPayloadFilter: resource.payloadFilter?.[input.eventType],
      })
    ) {
      return true;
    }
  }

  return false;
}

function payloadFilterAllowsAssociatedResourceEvent(input: {
  eventScopedPayloadFilter: unknown;
  payload: Record<string, unknown>;
}): boolean {
  if (input.eventScopedPayloadFilter === undefined) {
    return true;
  }

  const filter = parseWebhookPayloadFilter(input.eventScopedPayloadFilter);
  return evaluateWebhookPayloadFilter({
    filter,
    payload: input.payload,
  });
}
