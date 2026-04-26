import { buildUrlWithPath } from "@mistle/http";

export function buildIntegrationWebhookCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
  endpointKey: string;
}): string {
  return buildUrlWithPath(
    input.controlPlaneBaseUrl,
    `/p/integration/webhooks/${encodeURIComponent(input.targetKey)}/${encodeURIComponent(input.endpointKey)}`,
  );
}
