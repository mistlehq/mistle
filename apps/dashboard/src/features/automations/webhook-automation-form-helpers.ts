import type {
  WebhookAutomationFormValueKey,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import type {
  CreateWebhookAutomationInput,
  UpdateWebhookAutomationPatch,
  WebhookAutomation,
} from "./webhook-automations-types.js";

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
