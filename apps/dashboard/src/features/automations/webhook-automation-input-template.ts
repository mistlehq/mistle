const WebhookEventTypePlaceholder = "{{webhookEvent.eventType}}";
const PayloadPlaceholder = "{{payload}}";

const CanonicalTemplatePattern =
  /^\{"instructions":("(?:\\.|[^"\\])*"),"eventType":"\{\{webhookEvent\.eventType\}\}","payload":\{\{payload\}\}\}$/s;

export function buildWebhookAutomationInputTemplate(input: { instructions: string }): string {
  return `{"instructions":${JSON.stringify(input.instructions)},"eventType":"${WebhookEventTypePlaceholder}","payload":${PayloadPlaceholder}}`;
}

export function parseWebhookAutomationInputTemplate(input: {
  template: string;
}): { ok: true; instructions: string } | { ok: false; reason: string } {
  const match = CanonicalTemplatePattern.exec(input.template);

  if (match === null) {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  const [instructionsJson] = match.slice(1);
  if (instructionsJson === undefined) {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  const parsedInstructions = JSON.parse(instructionsJson);
  if (typeof parsedInstructions !== "string") {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  return {
    ok: true,
    instructions: parsedInstructions,
  };
}
