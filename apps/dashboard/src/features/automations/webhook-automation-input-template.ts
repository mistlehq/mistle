export const DefaultWebhookAutomationInputTemplate = [
  "Review the webhook event and decide what action to take.",
  "",
  "Event type: {{webhookEvent.eventType}}",
  "Payload:",
  "{{payload}}",
].join("\n");
