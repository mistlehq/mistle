export const WebhookEventTemplateFields = {
  ID: "id",
  EVENT_TYPE: "eventType",
  PROVIDER_EVENT_TYPE: "providerEventType",
  EXTERNAL_EVENT_ID: "externalEventId",
  EXTERNAL_DELIVERY_ID: "externalDeliveryId",
} as const;

export type WebhookEventTemplateField =
  (typeof WebhookEventTemplateFields)[keyof typeof WebhookEventTemplateFields];

export type WebhookEventTemplateContext = {
  webhookEvent: Record<WebhookEventTemplateField, string | null>;
};
