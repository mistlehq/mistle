const DefaultWebhookAutomationInstructions =
  "Review the webhook event and decide what action to take.";

export function buildDefaultWebhookAutomationInputTemplate(): string {
  return [
    DefaultWebhookAutomationInstructions,
    "",
    "Event type: {{webhookEvent.eventType}}",
    "Payload:",
    "{{payload}}",
  ].join("\n");
}
