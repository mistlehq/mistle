import type {
  WebhookAutomationFormValueKey,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import type {
  CreateWebhookAutomationInput,
  UpdateWebhookAutomationPatch,
  WebhookAutomation,
} from "./webhook-automations-types.js";
import {
  buildPayloadFilterFromConditions,
  formatPayloadFilterText,
  parsePayloadFilterBuilder,
  validatePayloadFilterConditions,
} from "./webhook-payload-filter-builder.js";

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
      eventTypes: [],
      payloadFilterEditorMode: "builder",
      payloadFilterBuilderMode: "all",
      payloadFilterConditions: [],
      payloadFilterText: "",
    };
  }

  const parsedBuilder = parsePayloadFilterBuilder({
    payloadFilter: automation.payloadFilter,
  });

  return {
    name: automation.name,
    integrationConnectionId: automation.integrationConnectionId,
    sandboxProfileId: automation.target.sandboxProfileId,
    enabled: automation.enabled,
    inputTemplate: automation.inputTemplate,
    conversationKeyTemplate: automation.conversationKeyTemplate,
    idempotencyKeyTemplate: automation.idempotencyKeyTemplate ?? "",
    eventTypes: automation.eventTypes ?? [],
    payloadFilterEditorMode: parsedBuilder.supported ? "builder" : "json",
    payloadFilterBuilderMode: parsedBuilder.supported ? parsedBuilder.mode : "all",
    payloadFilterConditions: parsedBuilder.supported ? parsedBuilder.conditions : [],
    payloadFilterText: formatPayloadFilterText(automation.payloadFilter),
  };
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

function parseOptionalEventTypes(value: readonly string[]): string[] | null {
  const items = value.filter((item) => item.trim().length > 0);

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

  if (values.payloadFilterEditorMode === "builder") {
    const builderError = validatePayloadFilterConditions({
      conditions: values.payloadFilterConditions,
    });
    if (builderError !== undefined) {
      errors.payloadFilterText = builderError;
    }
  } else if (!parseOptionalJsonObject(values.payloadFilterText).success) {
    errors.payloadFilterText = "Payload filter must be a JSON object.";
  }

  return errors;
}

function toPayloadFilterValue(values: WebhookAutomationFormValues): Record<string, unknown> | null {
  if (values.payloadFilterEditorMode === "builder") {
    const builtFilter = buildPayloadFilterFromConditions({
      mode: values.payloadFilterBuilderMode,
      conditions: values.payloadFilterConditions,
    });
    if (!builtFilter.success) {
      throw new Error("Expected payload filter builder state to be valid.");
    }

    return builtFilter.value;
  }

  const parsedPayloadFilter = parseOptionalJsonObject(values.payloadFilterText);
  if (!parsedPayloadFilter.success) {
    throw new Error("Expected payload filter text to be a valid JSON object.");
  }

  return parsedPayloadFilter.value;
}

export function toCreateWebhookAutomationPayload(
  values: WebhookAutomationFormValues,
): CreateWebhookAutomationInput {
  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationConnectionId: values.integrationConnectionId,
    inputTemplate: values.inputTemplate,
    conversationKeyTemplate: values.conversationKeyTemplate,
    ...(values.idempotencyKeyTemplate.trim().length === 0
      ? { idempotencyKeyTemplate: null }
      : { idempotencyKeyTemplate: values.idempotencyKeyTemplate }),
    eventTypes: parseOptionalEventTypes(values.eventTypes),
    payloadFilter: toPayloadFilterValue(values),
    target: {
      sandboxProfileId: values.sandboxProfileId,
    },
  };
}

export function toUpdateWebhookAutomationPayload(
  values: WebhookAutomationFormValues,
): UpdateWebhookAutomationPatch {
  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationConnectionId: values.integrationConnectionId,
    inputTemplate: values.inputTemplate,
    conversationKeyTemplate: values.conversationKeyTemplate,
    idempotencyKeyTemplate:
      values.idempotencyKeyTemplate.trim().length === 0 ? null : values.idempotencyKeyTemplate,
    eventTypes: parseOptionalEventTypes(values.eventTypes),
    payloadFilter: toPayloadFilterValue(values),
    target: {
      sandboxProfileId: values.sandboxProfileId,
    },
  };
}
