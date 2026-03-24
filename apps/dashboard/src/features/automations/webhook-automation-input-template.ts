const WebhookEventTypePlaceholder = "{{webhookEvent.eventType}}";
const PayloadPlaceholder = "{{payload}}";
const UnsupportedTemplateReason =
  "This automation uses a custom input template that cannot be edited in the instructions editor.";

export function buildWebhookAutomationInputTemplate(input: { instructions: string }): string {
  return `{"instructions":${JSON.stringify(input.instructions)},"eventType":"${WebhookEventTypePlaceholder}","payload":${PayloadPlaceholder}}`;
}

export function parseWebhookAutomationInputTemplate(input: {
  template: string;
}): { ok: true; instructions: string } | { ok: false; reason: string } {
  const payloadPlaceholderJsonString = JSON.stringify(PayloadPlaceholder);
  const normalizedTemplate = input.template.replaceAll(
    PayloadPlaceholder,
    payloadPlaceholderJsonString,
  );

  let parsedTemplate: unknown;

  try {
    parsedTemplate = JSON.parse(normalizedTemplate);
  } catch {
    return {
      ok: false,
      reason: UnsupportedTemplateReason,
    };
  }

  if (
    typeof parsedTemplate !== "object" ||
    parsedTemplate === null ||
    !("instructions" in parsedTemplate) ||
    !("eventType" in parsedTemplate) ||
    !("payload" in parsedTemplate) ||
    typeof parsedTemplate.instructions !== "string" ||
    parsedTemplate.eventType !== WebhookEventTypePlaceholder ||
    parsedTemplate.payload !== PayloadPlaceholder ||
    Object.keys(parsedTemplate).length !== 3
  ) {
    return {
      ok: false,
      reason: UnsupportedTemplateReason,
    };
  }

  return {
    ok: true,
    instructions: parsedTemplate.instructions,
  };
}
