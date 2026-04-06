export const DefaultWebhookAutomationInputTemplate = [
  "Review the webhook event and decide what action to take.",
  "",
  "Event type: {{webhookEvent.eventType}}",
  "Payload: {{payload}}",
].join("\n");

export const DefaultWebhookAutomationInputTemplatePlaceholder = [
  "Review the webhook event.",
  "",
  "Event type: {{webhookEvent.eventType}}",
  "Payload: {{payload}}",
].join("\n");
