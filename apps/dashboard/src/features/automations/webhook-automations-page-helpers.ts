import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import type { SandboxProfile } from "../sandbox-profiles/sandbox-profiles-types.js";
import type {
  WebhookAutomationFormOption,
  WebhookAutomationFormValueKey,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import type { WebhookAutomationListItemViewModel } from "./webhook-automation-list-view.js";
import type {
  CreateWebhookAutomationInput,
  UpdateWebhookAutomationPatch,
  WebhookAutomation,
} from "./webhook-automations-types.js";

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

export function toWebhookAutomationFormValues(
  automation: WebhookAutomation | null,
): WebhookAutomationFormValues {
  if (automation === null) {
    return {
      name: "",
      integrationConnectionId: "",
      sandboxProfileId: "",
      enabled: true,
      inputTemplate: "",
      conversationKeyTemplate: "",
      idempotencyKeyTemplate: "",
      eventTypesText: "",
      payloadFilterText: "",
    };
  }

  return {
    name: automation.name,
    integrationConnectionId: automation.integrationConnectionId,
    sandboxProfileId: automation.target.sandboxProfileId,
    enabled: automation.enabled,
    inputTemplate: automation.inputTemplate,
    conversationKeyTemplate: automation.conversationKeyTemplate,
    idempotencyKeyTemplate: automation.idempotencyKeyTemplate ?? "",
    eventTypesText: automation.eventTypes?.join(",") ?? "",
    payloadFilterText:
      automation.payloadFilter === null ? "" : JSON.stringify(automation.payloadFilter, null, 2),
  };
}

export function buildWebhookAutomationConnectionOptions(input: {
  connections: readonly IntegrationConnection[];
  targets: readonly IntegrationTarget[];
}): readonly WebhookAutomationFormOption[] {
  return sortOptionsByLabel(
    input.connections
      .filter((connection) => connection.status === "active")
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

function parseOptionalJsonObject(
  value: string,
): { success: true; value: Record<string, unknown> | null } | { success: false } {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { success: true, value: null };
  }

  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { success: false };
    }

    return { success: true, value: parsed };
  } catch {
    return { success: false };
  }
}

function parseOptionalEventTypes(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return items.length === 0 ? null : items;
}

export function validateWebhookAutomationFormValues(
  values: WebhookAutomationFormValues,
): Partial<Record<WebhookAutomationFormValueKey, string>> {
  const errors: Partial<Record<WebhookAutomationFormValueKey, string>> = {};

  if (values.name.trim().length === 0) {
    errors.name = "Automation name is required.";
  }

  if (values.integrationConnectionId.trim().length === 0) {
    errors.integrationConnectionId = "Select an integration connection.";
  }

  if (values.sandboxProfileId.trim().length === 0) {
    errors.sandboxProfileId = "Select a sandbox profile.";
  }

  if (values.inputTemplate.trim().length === 0) {
    errors.inputTemplate = "Input template is required.";
  }

  if (values.conversationKeyTemplate.trim().length === 0) {
    errors.conversationKeyTemplate = "Conversation key template is required.";
  }

  if (!parseOptionalJsonObject(values.payloadFilterText).success) {
    errors.payloadFilterText = "Payload filter must be a JSON object.";
  }

  return errors;
}

export function toCreateWebhookAutomationPayload(
  values: WebhookAutomationFormValues,
): CreateWebhookAutomationInput {
  const parsedPayloadFilter = parseOptionalJsonObject(values.payloadFilterText);
  if (!parsedPayloadFilter.success) {
    throw new Error("Expected payload filter text to be a valid JSON object.");
  }

  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationConnectionId: values.integrationConnectionId,
    inputTemplate: values.inputTemplate,
    conversationKeyTemplate: values.conversationKeyTemplate,
    ...(values.idempotencyKeyTemplate.trim().length === 0
      ? { idempotencyKeyTemplate: null }
      : { idempotencyKeyTemplate: values.idempotencyKeyTemplate }),
    eventTypes: parseOptionalEventTypes(values.eventTypesText),
    payloadFilter: parsedPayloadFilter.value,
    target: {
      sandboxProfileId: values.sandboxProfileId,
    },
  };
}

export function toUpdateWebhookAutomationPayload(
  values: WebhookAutomationFormValues,
): UpdateWebhookAutomationPatch {
  const parsedPayloadFilter = parseOptionalJsonObject(values.payloadFilterText);
  if (!parsedPayloadFilter.success) {
    throw new Error("Expected payload filter text to be a valid JSON object.");
  }

  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationConnectionId: values.integrationConnectionId,
    inputTemplate: values.inputTemplate,
    conversationKeyTemplate: values.conversationKeyTemplate,
    idempotencyKeyTemplate:
      values.idempotencyKeyTemplate.trim().length === 0 ? null : values.idempotencyKeyTemplate,
    eventTypes: parseOptionalEventTypes(values.eventTypesText),
    payloadFilter: parsedPayloadFilter.value,
    target: {
      sandboxProfileId: values.sandboxProfileId,
    },
  };
}
