export const DefaultWebhookAutomationInputTemplate = [
  "Review the webhook event and decide what action to take.",
  "",
  "Event type: {{webhookEvent.eventType}}",
  "Payload: {{payload}}",
].join("\n");

export const InitialWebhookAutomationInputTemplate = [
  "Replace this with your instructions.",
  "",
  "Put core instructions first so that they can be cached. Add event details after that.",
  "",
  "Event type: {{webhookEvent.eventType}}",
  "Payload: {{payload}}",
].join("\n");

export const WebhookAutomationInputTemplatePlaceholder =
  "Put core instructions first so that they can be cached. Add event details after that.";

export const UntouchedWebhookAutomationInputTemplateError =
  "Please replace the instructions placeholder with your own instructions.";
