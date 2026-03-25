import type { IntegrationRegistry } from "@mistle/integrations-core";

export function assertWebhookCapableTargetDefinition(
  integrationRegistry: IntegrationRegistry,
  input: {
    familyId: string;
    variantId: string;
  },
): {
  supportsWebhookHandling: boolean;
  hasSupportedWebhookEvents: boolean;
} {
  const definition = integrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });

  if (definition === undefined) {
    throw new Error(
      `Integration definition '${input.familyId}/${input.variantId}' is not registered.`,
    );
  }

  if (definition.webhookHandler === undefined) {
    return {
      supportsWebhookHandling: false,
      hasSupportedWebhookEvents: false,
    };
  }

  return {
    supportsWebhookHandling: true,
    hasSupportedWebhookEvents: (definition.supportedWebhookEvents?.length ?? 0) > 0,
  };
}
