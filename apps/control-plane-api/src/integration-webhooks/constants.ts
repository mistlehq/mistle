export const INTEGRATION_WEBHOOKS_ROUTE_BASE_PATH = "/v1/integration/webhooks";

export const IntegrationWebhooksBadRequestCodes = {
  INVALID_WEBHOOK_REQUEST: "INVALID_WEBHOOK_REQUEST",
} as const;

export const IntegrationWebhooksNotFoundCodes = {
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  CONNECTION_NOT_FOUND: "CONNECTION_NOT_FOUND",
} as const;
