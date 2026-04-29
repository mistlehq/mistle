import { BadRequestError } from "@mistle/http/errors.js";
import {
  isWebhookTriggerSupportedByCapabilities,
  parseWebhookTriggerCapabilitiesProviderMetadata,
} from "@mistle/integrations-core";
import type { IntegrationWebhookEventDefinition } from "@mistle/integrations-core";

import { AutomationWebhooksBadRequestCodes } from "../constants.js";

export function assertWebhookTriggerRequirementsOrThrow(input: {
  eventTypes: readonly string[] | null;
  providerMetadata: Readonly<Record<string, unknown>>;
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const capabilities = parseWebhookTriggerCapabilitiesProviderMetadata(input.providerMetadata);

  const selectedEvents =
    input.eventTypes === null
      ? input.supportedWebhookEvents
      : input.eventTypes.flatMap((eventType) =>
          input.supportedWebhookEvents.filter(
            (eventDefinition) => eventDefinition.eventType === eventType,
          ),
        );

  for (const eventDefinition of selectedEvents) {
    if (
      !isWebhookTriggerSupportedByCapabilities({
        capabilities,
        requirements: eventDefinition.requirements,
      })
    ) {
      throw new BadRequestError(
        AutomationWebhooksBadRequestCodes.INVALID_WEBHOOK_TRIGGER_REQUIREMENTS,
        `Webhook source does not satisfy trigger requirements for '${eventDefinition.eventType}'.`,
      );
    }
  }
}
