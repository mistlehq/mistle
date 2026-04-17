import type { IntegrationWebhookEventParameterDefinition } from "@mistle/integrations-core";

export function createInvocationTokenParameter(
  payloadPath: ReadonlyArray<string>,
): IntegrationWebhookEventParameterDefinition {
  return {
    id: "invocationToken",
    label: "invocation token",
    kind: "string",
    payloadPath: [...payloadPath],
    matchMode: "contains_token",
    controlVariant: "invocation-token",
  };
}
