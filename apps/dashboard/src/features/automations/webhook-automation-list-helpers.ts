import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import type { WebhookAutomationFormOption } from "./webhook-automation-form.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-view.js";
import type { WebhookAutomation } from "./webhook-automations-types.js";

const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

function sortOptionsByLabel<T extends { label: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.label.localeCompare(right.label));
}

function compactRelativeTimeFromMs(deltaMs: number): string {
  const absDeltaMs = Math.abs(deltaMs);

  if (absDeltaMs < 60_000) {
    return "now";
  }

  const minuteDelta = Math.round(deltaMs / 60_000);
  if (Math.abs(minuteDelta) < 60) {
    return RELATIVE_TIME_FORMATTER.format(minuteDelta, "minute")
      .replace(" minutes", " min")
      .replace(" minute", " min");
  }

  const hourDelta = Math.round(deltaMs / 3_600_000);
  if (Math.abs(hourDelta) < 24) {
    return RELATIVE_TIME_FORMATTER.format(hourDelta, "hour")
      .replace(" hours", " hr")
      .replace(" hour", " hr");
  }

  const dayDelta = Math.round(deltaMs / 86_400_000);
  if (Math.abs(dayDelta) < 30) {
    return RELATIVE_TIME_FORMATTER.format(dayDelta, "day");
  }

  const monthDelta = Math.round(deltaMs / 2_592_000_000);
  if (Math.abs(monthDelta) < 12) {
    return RELATIVE_TIME_FORMATTER.format(monthDelta, "month")
      .replace(" months", " mo")
      .replace(" month", " mo");
  }

  const yearDelta = Math.round(deltaMs / 31_536_000_000);
  return RELATIVE_TIME_FORMATTER.format(yearDelta, "year")
    .replace(" years", " yr")
    .replace(" year", " yr");
}

export function formatWebhookAutomationUpdatedAt(isoDateTime: string): string {
  const epochMs = Date.parse(isoDateTime);
  if (!Number.isFinite(epochMs)) {
    return "Unknown";
  }

  return compactRelativeTimeFromMs(epochMs - Date.now());
}

function summarizeEventTypes(eventTypes: readonly string[] | null): string {
  if (eventTypes === null || eventTypes.length === 0) {
    return "All events";
  }

  return eventTypes.join(", ");
}

export function buildWebhookAutomationConnectionOptions(input: {
  connections: readonly IntegrationConnection[];
  preservedConnectionId?: string;
  targets: readonly IntegrationTarget[];
}): readonly WebhookAutomationFormOption[] {
  return sortOptionsByLabel(
    input.connections
      .filter(
        (connection) =>
          connection.status === "active" || connection.id === input.preservedConnectionId,
      )
      .map((connection) => {
        const target = input.targets.find((item) => item.targetKey === connection.targetKey);
        return {
          value: connection.id,
          label: connection.displayName,
          ...(target === undefined ? {} : { description: target.displayName }),
        };
      }),
  );
}

export function buildWebhookAutomationSandboxProfileOptions(input: {
  sandboxProfiles: readonly SandboxProfile[];
}): readonly WebhookAutomationFormOption[] {
  return sortOptionsByLabel(
    input.sandboxProfiles.map((profile) => ({
      value: profile.id,
      label: profile.displayName,
      description: profile.status,
    })),
  );
}

export function buildWebhookAutomationListItems(input: {
  automations: readonly WebhookAutomation[];
  connections: readonly IntegrationConnection[];
  sandboxProfiles: readonly SandboxProfile[];
}): readonly WebhookAutomationListItemViewModel[] {
  return input.automations.map((automation) => {
    const connection = input.connections.find(
      (candidate) => candidate.id === automation.integrationConnectionId,
    );
    const sandboxProfile = input.sandboxProfiles.find(
      (candidate) => candidate.id === automation.target.sandboxProfileId,
    );

    return {
      id: automation.id,
      name: automation.name,
      integrationConnectionName: connection?.displayName ?? automation.integrationConnectionId,
      sandboxProfileName: sandboxProfile?.displayName ?? automation.target.sandboxProfileId,
      eventSummary: summarizeEventTypes(automation.eventTypes),
      updatedAtLabel: formatWebhookAutomationUpdatedAt(automation.updatedAt),
      enabled: automation.enabled,
    };
  });
}
