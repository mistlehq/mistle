const WebhookEventTypePlaceholder = "{{webhookEvent.eventType}}";
const PayloadPlaceholder = "{{payload}}";
const PayloadPlaceholderSentinel = "__MISTLE_PAYLOAD_PLACEHOLDER__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeTemplateForJsonParse(template: string): string {
  let normalized = "";
  let index = 0;
  let inString = false;
  let escaping = false;

  while (index < template.length) {
    const currentCharacter = template[index];

    if (currentCharacter === undefined) {
      break;
    }

    if (inString) {
      normalized += currentCharacter;

      if (escaping) {
        escaping = false;
      } else if (currentCharacter === "\\") {
        escaping = true;
      } else if (currentCharacter === '"') {
        inString = false;
      }

      index += 1;
      continue;
    }

    if (currentCharacter === '"') {
      inString = true;
      normalized += currentCharacter;
      index += 1;
      continue;
    }

    if (template.startsWith(PayloadPlaceholder, index)) {
      normalized += JSON.stringify(PayloadPlaceholderSentinel);
      index += PayloadPlaceholder.length;
      continue;
    }

    normalized += currentCharacter;
    index += 1;
  }

  return normalized;
}

export function buildWebhookAutomationInputTemplate(input: { instructions: string }): string {
  return `{"instructions":${JSON.stringify(input.instructions)},"eventType":"${WebhookEventTypePlaceholder}","payload":${PayloadPlaceholder}}`;
}

export function parseWebhookAutomationInputTemplate(input: {
  template: string;
}): { ok: true; instructions: string } | { ok: false; reason: string } {
  let parsedTemplate: unknown;
  try {
    parsedTemplate = JSON.parse(normalizeTemplateForJsonParse(input.template));
  } catch {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  if (!isRecord(parsedTemplate)) {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  const keys = Object.keys(parsedTemplate);
  if (
    keys.length !== 3 ||
    !keys.includes("instructions") ||
    !keys.includes("eventType") ||
    !keys.includes("payload")
  ) {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  if (
    typeof parsedTemplate["instructions"] !== "string" ||
    parsedTemplate["eventType"] !== WebhookEventTypePlaceholder ||
    parsedTemplate["payload"] !== PayloadPlaceholderSentinel
  ) {
    return {
      ok: false,
      reason:
        "This automation uses a custom input template that cannot be edited in the instructions editor.",
    };
  }

  return {
    ok: true,
    instructions: parsedTemplate["instructions"],
  };
}
