import {
  parseWebhookTriggerCapabilitiesProviderMetadata,
  resolveWebhookTriggerCapabilityEvents,
  type IntegrationWebhookEventDefinition,
} from "@mistle/integrations-core";

export function expectProviderMetadataSatisfiesWebhookTriggerRequirements(input: {
  providerMetadata: Record<string, unknown>;
  supportedWebhookEvents: readonly IntegrationWebhookEventDefinition[];
}): void {
  const capabilityEvents = resolveWebhookTriggerCapabilityEvents({
    capabilities: parseWebhookTriggerCapabilitiesProviderMetadata(input.providerMetadata),
    supportedWebhookEvents: input.supportedWebhookEvents,
  });
  const disabledEvents = capabilityEvents.filter((event) => event.status === "not_enabled");
  if (disabledEvents.length === 0) {
    return;
  }

  throw new Error(
    `Webhook source provider metadata does not satisfy trigger requirements for: ${disabledEvents
      .map((event) => event.eventDefinition.eventType)
      .join(", ")}.`,
  );
}
