import type {
  WebhookTriggerEventOption,
  WebhookTriggerEventOptionAvailability,
} from "./webhook-trigger-event-types.js";

function formatFallbackConnectionLabel(webhookSourceId: string): string {
  return webhookSourceId.trim().length > 0 ? webhookSourceId : "Unknown webhook source";
}

export function isWebhookTriggerEventOptionUnavailable(option: WebhookTriggerEventOption): boolean {
  return option.availability !== undefined && option.availability !== "available";
}

export function resolveWebhookTriggerEventOptionAvailabilityCopy(
  availability: WebhookTriggerEventOptionAvailability,
): {
  badgeLabel: string;
  description: string;
} {
  if (availability === "wrong_profile") {
    return {
      badgeLabel: "Wrong profile",
      description: "Event is unavailable for the selected sandbox profile.",
    };
  }

  return {
    badgeLabel: "Unavailable",
    description: "No longer available from your connected integrations.",
  };
}

export function createSyntheticWebhookTriggerEventOption(input: {
  triggerId: string;
  availability: Exclude<WebhookTriggerEventOptionAvailability, "available">;
  connectionLabel?: string;
  label?: string;
}): WebhookTriggerEventOption {
  const [integrationWebhookSourceId = "", ...eventTypeParts] = input.triggerId.split("::");
  const eventType = eventTypeParts.join("::");
  const availabilityCopy = resolveWebhookTriggerEventOptionAvailabilityCopy(input.availability);

  return {
    id: input.triggerId,
    eventType,
    integrationWebhookSourceId,
    connectionId: "",
    connectionLabel:
      input.connectionLabel ?? formatFallbackConnectionLabel(integrationWebhookSourceId),
    label: input.label ?? (eventType.length > 0 ? eventType : input.triggerId),
    description: availabilityCopy.description,
    category: "Unavailable",
    availability: input.availability,
  };
}

export function resolveSelectedWebhookTriggerEventIssues(input: {
  selectedEventOptions: readonly WebhookTriggerEventOption[];
}): readonly string[] {
  const uniqueIssues = new Set<string>();

  for (const option of input.selectedEventOptions) {
    if (!isWebhookTriggerEventOptionUnavailable(option)) {
      continue;
    }

    uniqueIssues.add(
      option.description ?? "Remove events that are no longer available before saving.",
    );
  }

  return [...uniqueIssues];
}
