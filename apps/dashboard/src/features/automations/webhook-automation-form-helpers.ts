import { resolveCommonWebhookAutomationConversationKeyOptions } from "./webhook-automation-conversation-key-options.js";
import { resolveSelectedWebhookAutomationEventIssues } from "./webhook-automation-event-option-availability.js";
import type {
  WebhookAutomationFormValueKey,
  WebhookAutomationFormValues,
} from "./webhook-automation-form.js";
import { DefaultWebhookAutomationInputTemplate } from "./webhook-automation-input-template.js";
import { createWebhookAutomationTriggerId } from "./webhook-automation-option-builders.js";
import {
  extractWebhookAutomationTriggerParameterValues,
  mergeWebhookAutomationPayloadFilter,
} from "./webhook-automation-trigger-parameters.js";
import { resolveSelectedWebhookAutomationEventOptions } from "./webhook-automation-trigger-picker.js";
import type { WebhookAutomationEventOption } from "./webhook-automation-trigger-types.js";
import type {
  CreateWebhookAutomationInput,
  UpdateWebhookAutomationPatch,
  WebhookAutomation,
} from "./webhook-automations-types.js";

type ResolvedSelectedTriggers = {
  connectionIds: string[];
  eventTypes: string[];
  webhookSourceIds: string[];
  webhookSourceId: string | null;
};

function resolveSelectedTriggers(input: {
  triggerIds: readonly string[];
  eventOptions: readonly WebhookAutomationEventOption[];
}): ResolvedSelectedTriggers {
  const selectedOptions = input.triggerIds
    .map((triggerId) => input.eventOptions.find((option) => option.id === triggerId))
    .filter((option): option is WebhookAutomationEventOption => option !== undefined);

  const fallbackSelections = input.triggerIds
    .filter((triggerId) => !selectedOptions.some((option) => option.id === triggerId))
    .map((triggerId) => {
      const [webhookSourceId = "", ...eventTypeParts] = triggerId.split("::");
      return {
        webhookSourceId,
        eventType: eventTypeParts.join("::"),
      };
    });

  const connectionIds = [
    ...new Set(
      selectedOptions
        .map((option) => option.connectionId)
        .filter((connectionId) => connectionId.trim().length > 0),
    ),
  ];
  const webhookSourceIds = [
    ...new Set(
      [
        ...selectedOptions.map((option) => option.integrationWebhookSourceId),
        ...fallbackSelections.map((selection) => selection.webhookSourceId),
      ].filter((webhookSourceId) => webhookSourceId.trim().length > 0),
    ),
  ];
  const eventTypes = [
    ...selectedOptions.map((option) => option.eventType),
    ...fallbackSelections
      .map((selection) => selection.eventType)
      .filter((eventType) => eventType.length > 0),
  ];

  return {
    connectionIds,
    webhookSourceIds,
    eventTypes,
    webhookSourceId: webhookSourceIds.length === 1 ? (webhookSourceIds[0] ?? null) : null,
  };
}

function parseOptionalEventTypes(value: readonly string[]): string[] | null {
  const items = value.filter((item) => item.trim().length > 0);

  return items.length === 0 ? null : items;
}

export function toWebhookAutomationFormValues(
  automation: WebhookAutomation | null,
  eventOptions: readonly WebhookAutomationEventOption[] = [],
): WebhookAutomationFormValues {
  if (automation === null) {
    return {
      name: "",
      sandboxProfileId: "",
      enabled: true,
      inputTemplate: DefaultWebhookAutomationInputTemplate,
      conversationKeyTemplate: "",
      triggerIds: [],
      triggerParameterValues: {},
    };
  }

  const selectedTriggerIds = (automation.eventTypes ?? []).map((eventType) =>
    createWebhookAutomationTriggerId({
      webhookSourceId: automation.integrationWebhookSourceId,
      eventType,
    }),
  );
  const extractedTriggerParameterValues = extractWebhookAutomationTriggerParameterValues({
    eventOptions,
    selectedTriggerIds,
    payloadFilter: automation.payloadFilter,
  });

  return {
    name: automation.name,
    sandboxProfileId: automation.target.sandboxProfileId,
    enabled: automation.enabled,
    inputTemplate: automation.inputTemplate,
    conversationKeyTemplate: automation.conversationKeyTemplate,
    triggerIds: selectedTriggerIds,
    triggerParameterValues: extractedTriggerParameterValues.triggerParameterValues,
  };
}

export function validateWebhookAutomationFormValues(
  values: WebhookAutomationFormValues,
  eventOptions: readonly WebhookAutomationEventOption[] = [],
): Partial<Record<WebhookAutomationFormValueKey, string>> {
  const errors: Partial<Record<WebhookAutomationFormValueKey, string>> = {};

  if (values.name.trim().length === 0) {
    errors.name = "Automation name is required.";
  }

  if (values.triggerIds.length === 0) {
    errors.triggerIds = "Please add a trigger";
  } else {
    const selectedEventOptions = resolveSelectedWebhookAutomationEventOptions({
      eventOptions,
      selectedTriggerIds: values.triggerIds,
    });
    const triggerIssues = resolveSelectedWebhookAutomationEventIssues({
      selectedEventOptions,
    });
    const firstTriggerIssue = triggerIssues[0];
    if (firstTriggerIssue !== undefined) {
      errors.triggerIds = firstTriggerIssue;
    }

    const resolvedTriggers = resolveSelectedTriggers({
      triggerIds: values.triggerIds,
      eventOptions,
    });

    if (errors.triggerIds === undefined && resolvedTriggers.connectionIds.length > 1) {
      errors.triggerIds =
        "All triggers in one automation must come from the same integration connection.";
    } else if (errors.triggerIds === undefined && resolvedTriggers.webhookSourceIds.length > 1) {
      errors.triggerIds = "All triggers in one automation must come from the same webhook source.";
    } else if (errors.triggerIds === undefined && resolvedTriggers.webhookSourceId === null) {
      errors.triggerIds = "Select triggers from an available webhook source.";
    }
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

  const selectedConversationKeyOptions = resolveCommonWebhookAutomationConversationKeyOptions({
    selectedEventOptions: resolveSelectedWebhookAutomationEventOptions({
      eventOptions,
      selectedTriggerIds: values.triggerIds,
    }),
  });
  if (
    selectedConversationKeyOptions.length > 0 &&
    !selectedConversationKeyOptions.some(
      (conversationKeyOption) => conversationKeyOption.template === values.conversationKeyTemplate,
    )
  ) {
    errors.conversationKeyTemplate = "Select a supported conversation grouping.";
  }

  return errors;
}

function toPayloadFilterValue(input: {
  values: WebhookAutomationFormValues;
  eventOptions: readonly WebhookAutomationEventOption[];
}): Record<string, unknown> | null {
  return mergeWebhookAutomationPayloadFilter({
    eventOptions: input.eventOptions,
    selectedTriggerIds: input.values.triggerIds,
    triggerParameterValues: input.values.triggerParameterValues,
    advancedPayloadFilter: null,
  });
}

function resolveAutomationSubmissionShape(input: {
  values: WebhookAutomationFormValues;
  eventOptions: readonly WebhookAutomationEventOption[];
}): {
  integrationWebhookSourceId: string;
  eventTypes: string[] | null;
} {
  const resolvedTriggers = resolveSelectedTriggers({
    triggerIds: input.values.triggerIds,
    eventOptions: input.eventOptions,
  });

  if (resolvedTriggers.connectionIds.length > 1) {
    throw new Error(
      "All triggers in one automation must come from the same integration connection.",
    );
  }

  if (resolvedTriggers.webhookSourceIds.length > 1) {
    throw new Error("All triggers in one automation must come from the same webhook source.");
  }

  if (resolvedTriggers.webhookSourceId === null) {
    throw new Error(
      "A valid integration webhook source could not be derived from the selected triggers.",
    );
  }

  return {
    integrationWebhookSourceId: resolvedTriggers.webhookSourceId,
    eventTypes: parseOptionalEventTypes(resolvedTriggers.eventTypes),
  };
}

export function toCreateWebhookAutomationPayload(
  values: WebhookAutomationFormValues,
  eventOptions: readonly WebhookAutomationEventOption[] = [],
): CreateWebhookAutomationInput {
  const resolvedSubmissionShape = resolveAutomationSubmissionShape({
    values,
    eventOptions,
  });

  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationWebhookSourceId: resolvedSubmissionShape.integrationWebhookSourceId,
    inputTemplate: values.inputTemplate.trim(),
    conversationKeyTemplate: values.conversationKeyTemplate,
    idempotencyKeyTemplate: null,
    eventTypes: resolvedSubmissionShape.eventTypes,
    payloadFilter: toPayloadFilterValue({ values, eventOptions }),
    target: {
      sandboxProfileId: values.sandboxProfileId,
    },
  };
}

export function toUpdateWebhookAutomationPayload(
  values: WebhookAutomationFormValues,
  eventOptions: readonly WebhookAutomationEventOption[] = [],
): UpdateWebhookAutomationPatch {
  const resolvedSubmissionShape = resolveAutomationSubmissionShape({
    values,
    eventOptions,
  });

  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationWebhookSourceId: resolvedSubmissionShape.integrationWebhookSourceId,
    inputTemplate: values.inputTemplate.trim(),
    conversationKeyTemplate: values.conversationKeyTemplate,
    idempotencyKeyTemplate: null,
    eventTypes: resolvedSubmissionShape.eventTypes,
    payloadFilter: toPayloadFilterValue({ values, eventOptions }),
    target: {
      sandboxProfileId: values.sandboxProfileId,
    },
  };
}
