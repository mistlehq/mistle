import { BadRequestError } from "@mistle/http/errors.js";
import { parseWebhookPayloadFilter } from "@mistle/webhooks";

export type WebhookTriggerEventConditionInput = {
  eventType: string;
  payloadFilter?: Record<string, unknown> | null | undefined;
};

export type NormalizedWebhookTriggerEventCondition = {
  eventType: string;
  payloadFilter?: Record<string, unknown> | undefined;
};

function normalizeConditionPayloadFilter(
  payloadFilter: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (
    payloadFilter === undefined ||
    payloadFilter === null ||
    Object.keys(payloadFilter).length === 0
  ) {
    return undefined;
  }

  try {
    parseWebhookPayloadFilter(payloadFilter);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid payloadFilter.";
    throw new BadRequestError(
      "VALIDATION_ERROR",
      `Invalid eventConditions payloadFilter. ${message}`,
    );
  }

  return payloadFilter;
}

export function normalizeWebhookTriggerEventConditions(
  eventConditions: readonly WebhookTriggerEventConditionInput[],
): NormalizedWebhookTriggerEventCondition[] {
  if (eventConditions.length === 0) {
    throw new BadRequestError(
      "VALIDATION_ERROR",
      "Webhook trigger must include at least one event condition.",
    );
  }

  return eventConditions.map((condition) => {
    const payloadFilter = normalizeConditionPayloadFilter(condition.payloadFilter);

    return {
      eventType: condition.eventType,
      ...(payloadFilter === undefined ? {} : { payloadFilter }),
    };
  });
}
