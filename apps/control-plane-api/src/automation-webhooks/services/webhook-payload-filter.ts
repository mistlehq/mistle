import { BadRequestError } from "@mistle/http/errors.js";
import { parseEventScopedWebhookPayloadFilter } from "@mistle/webhooks";

export function normalizeWebhookPayloadFilter(
  payloadFilter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (payloadFilter === undefined) {
    return undefined;
  }

  if (payloadFilter === null || Object.keys(payloadFilter).length === 0) {
    return null;
  }

  return payloadFilter;
}

export function assertEventScopedWebhookPayloadFilterOrThrow(input: {
  eventTypes: readonly string[] | null;
  payloadFilter: Record<string, unknown> | null;
}): void {
  if (input.payloadFilter === null) {
    return;
  }

  let parsedPayloadFilter: ReturnType<typeof parseEventScopedWebhookPayloadFilter>;
  try {
    parsedPayloadFilter = parseEventScopedWebhookPayloadFilter(input.payloadFilter);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payloadFilter.";
    throw new BadRequestError("VALIDATION_ERROR", `Invalid payloadFilter. ${message}`);
  }

  if (input.eventTypes === null) {
    return;
  }

  const eventTypeSet = new Set(input.eventTypes);
  for (const eventType of Object.keys(parsedPayloadFilter)) {
    if (!eventTypeSet.has(eventType)) {
      throw new BadRequestError(
        "VALIDATION_ERROR",
        `payloadFilter contains an event type that is not selected: ${eventType}`,
      );
    }
  }
}
