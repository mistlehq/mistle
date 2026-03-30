import type {
  WebhookAutomationEventOption,
  WebhookAutomationEventOptionAvailability,
} from "./webhook-automation-trigger-types.js";

function formatFallbackConnectionLabel(connectionId: string): string {
  return connectionId.trim().length > 0 ? connectionId : "Unknown connection";
}

export function isWebhookAutomationEventOptionUnavailable(
  option: WebhookAutomationEventOption,
): boolean {
  return option.availability !== undefined && option.availability !== "available";
}

export function resolveWebhookAutomationEventOptionAvailabilityCopy(
  availability: WebhookAutomationEventOptionAvailability,
): {
  badgeLabel: string;
  description: string;
} {
  if (availability === "wrong_profile") {
    return {
      badgeLabel: "Wrong profile",
      description: "Trigger is unavailable for the selected sandbox profile.",
    };
  }

  return {
    badgeLabel: "Unavailable",
    description: "No longer available from your connected integrations.",
  };
}

export function createSyntheticWebhookAutomationEventOption(input: {
  triggerId: string;
  availability: Exclude<WebhookAutomationEventOptionAvailability, "available">;
  connectionLabel?: string;
  label?: string;
}): WebhookAutomationEventOption {
  const [connectionId = "", ...eventTypeParts] = input.triggerId.split("::");
  const eventType = eventTypeParts.join("::");
  const availabilityCopy = resolveWebhookAutomationEventOptionAvailabilityCopy(input.availability);

  return {
    id: input.triggerId,
    eventType,
    connectionId,
    connectionLabel: input.connectionLabel ?? formatFallbackConnectionLabel(connectionId),
    label: input.label ?? (eventType.length > 0 ? eventType : input.triggerId),
    description: availabilityCopy.description,
    category: "Unavailable",
    availability: input.availability,
  };
}

export function resolveSelectedWebhookAutomationEventIssues(input: {
  selectedEventOptions: readonly WebhookAutomationEventOption[];
}): readonly string[] {
  const uniqueIssues = new Set<string>();

  for (const option of input.selectedEventOptions) {
    if (!isWebhookAutomationEventOptionUnavailable(option)) {
      continue;
    }

    uniqueIssues.add(
      option.description ?? "Remove triggers that are no longer available before saving.",
    );
  }

  return [...uniqueIssues];
}
