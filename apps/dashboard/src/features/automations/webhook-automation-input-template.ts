const WebhookEventTypePlaceholder = "{{webhookEvent.eventType}}";
const PayloadPlaceholder = "{{payload}}";
const InstructionsCaptureVariableName = "__mistleWebhookAutomationInstructions";
const InstructionsCapturePrefix = `{% capture ${InstructionsCaptureVariableName} %}`;
const InstructionsCaptureSuffix = `{% endcapture %}{"instructions":{{ ${InstructionsCaptureVariableName} | json }},"eventType":"${WebhookEventTypePlaceholder}","payload":${PayloadPlaceholder}}`;
const UnsupportedTemplateReason =
  "This automation uses a custom input template that cannot be edited in the instructions editor.";

export function buildWebhookAutomationInputTemplate(input: { instructions: string }): string {
  return `${InstructionsCapturePrefix}${input.instructions}${InstructionsCaptureSuffix}`;
}

export function parseWebhookAutomationInputTemplate(input: {
  template: string;
}): { ok: true; instructions: string } | { ok: false; reason: string } {
  if (
    !input.template.startsWith(InstructionsCapturePrefix) ||
    !input.template.endsWith(InstructionsCaptureSuffix)
  ) {
    return {
      ok: false,
      reason: UnsupportedTemplateReason,
    };
  }

  return {
    ok: true,
    instructions: input.template.slice(
      InstructionsCapturePrefix.length,
      input.template.length - InstructionsCaptureSuffix.length,
    ),
  };
}
