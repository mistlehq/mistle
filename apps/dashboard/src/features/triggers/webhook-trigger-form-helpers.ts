import { resolveCommonWebhookTriggerConversationKeyOptions } from "./webhook-trigger-conversation-key-options.js";
import { resolveSelectedWebhookTriggerEventIssues } from "./webhook-trigger-event-option-availability.js";
import {
  extractWebhookTriggerEventParameterRules,
  mergeWebhookTriggerPayloadFilter,
} from "./webhook-trigger-event-parameters.js";
import { resolveSelectedWebhookTriggerEventOptions } from "./webhook-trigger-event-picker-state.js";
import type { WebhookTriggerEventOption } from "./webhook-trigger-event-types.js";
import type {
  WebhookTriggerFormValueKey,
  WebhookTriggerFormValues,
} from "./webhook-trigger-form-types.js";
import { DefaultWebhookTriggerMessageTemplate } from "./webhook-trigger-input-template.js";
import {
  createWebhookTriggerEventId,
  WebhookTriggerWorkspaceRootRepositoryOptionValue,
} from "./webhook-trigger-option-builders.js";
import type {
  CreateWebhookTriggerInput,
  UpdateWebhookTriggerPatch,
  WebhookTrigger,
} from "./webhook-triggers-types.js";

type ResolvedSelectedEvents = {
  connectionIds: string[];
  eventTypes: string[];
  webhookSourceIds: string[];
  webhookSourceId: string | null;
};

function resolveSelectedEvents(input: {
  eventIds: readonly string[];
  eventOptions: readonly WebhookTriggerEventOption[];
}): ResolvedSelectedEvents {
  const selectedOptions = input.eventIds
    .map((triggerId) => input.eventOptions.find((option) => option.id === triggerId))
    .filter((option): option is WebhookTriggerEventOption => option !== undefined);

  const fallbackSelections = input.eventIds
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

export function toWebhookTriggerFormValues(
  trigger: WebhookTrigger | null,
  eventOptions: readonly WebhookTriggerEventOption[] = [],
): WebhookTriggerFormValues {
  if (trigger === null) {
    return {
      name: "",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      inputTemplate: DefaultWebhookTriggerMessageTemplate,
      instructions: "",
      conversationKeyTemplate: "",
      eventIds: [],
      eventParameterRules: {},
      remainingPayloadFilter: null,
    };
  }

  const selectedEventIds = (trigger.eventTypes ?? []).map((eventType) =>
    createWebhookTriggerEventId({
      webhookSourceId: trigger.integrationWebhookSourceId,
      eventType,
    }),
  );
  const extractedEventParameterRules = extractWebhookTriggerEventParameterRules({
    eventOptions,
    selectedEventIds,
    payloadFilter: trigger.payloadFilter,
  });

  return {
    name: trigger.name,
    sandboxProfileId: trigger.target.sandboxProfileId,
    primaryRepositoryId: trigger.target.primaryRepositoryId ?? "",
    enabled: trigger.enabled,
    inputTemplate: trigger.inputTemplate,
    instructions: trigger.instructions ?? "",
    conversationKeyTemplate: trigger.conversationKeyTemplate,
    eventIds: selectedEventIds,
    eventParameterRules: extractedEventParameterRules.eventParameterRules,
    remainingPayloadFilter: extractedEventParameterRules.remainingPayloadFilter,
  };
}

export function validateWebhookTriggerFormValues(
  values: WebhookTriggerFormValues,
  eventOptions: readonly WebhookTriggerEventOption[] = [],
): Partial<Record<WebhookTriggerFormValueKey, string>> {
  const errors: Partial<Record<WebhookTriggerFormValueKey, string>> = {};
  const trimmedInputTemplate = values.inputTemplate.trim();

  if (values.name.trim().length === 0) {
    errors.name = "Trigger name is required.";
  }

  if (values.eventIds.length === 0) {
    errors.eventIds = "Please add an event";
  } else {
    const selectedEventOptions = resolveSelectedWebhookTriggerEventOptions({
      eventOptions,
      selectedEventIds: values.eventIds,
    });
    const triggerIssues = resolveSelectedWebhookTriggerEventIssues({
      selectedEventOptions,
    });
    const firstTriggerIssue = triggerIssues[0];
    if (firstTriggerIssue !== undefined) {
      errors.eventIds = firstTriggerIssue;
    }

    const resolvedEvents = resolveSelectedEvents({
      eventIds: values.eventIds,
      eventOptions,
    });

    if (errors.eventIds === undefined && resolvedEvents.connectionIds.length > 1) {
      errors.eventIds = "All events in one trigger must come from the same integration connection.";
    } else if (errors.eventIds === undefined && resolvedEvents.webhookSourceIds.length > 1) {
      errors.eventIds = "All events in one trigger must come from the same webhook source.";
    } else if (errors.eventIds === undefined && resolvedEvents.webhookSourceId === null) {
      errors.eventIds = "Select triggers from an available webhook source.";
    }
  }

  if (values.sandboxProfileId.trim().length === 0) {
    errors.sandboxProfileId = "Select a sandbox profile.";
  }

  if (trimmedInputTemplate.length === 0) {
    errors.inputTemplate = "User message is required.";
  }

  if (values.conversationKeyTemplate.trim().length === 0) {
    errors.conversationKeyTemplate = "Conversation key template is required.";
  }

  const selectedConversationKeyOptions = resolveCommonWebhookTriggerConversationKeyOptions({
    selectedEventOptions: resolveSelectedWebhookTriggerEventOptions({
      eventOptions,
      selectedEventIds: values.eventIds,
    }),
    eventParameterRules: values.eventParameterRules,
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
  values: WebhookTriggerFormValues;
  eventOptions: readonly WebhookTriggerEventOption[];
}): Record<string, unknown> | null {
  return mergeWebhookTriggerPayloadFilter({
    eventOptions: input.eventOptions,
    selectedEventIds: input.values.eventIds,
    eventParameterRules: input.values.eventParameterRules,
    advancedPayloadFilter: input.values.remainingPayloadFilter ?? null,
  });
}

function toPrimaryRepositoryId(value: string): string | null {
  const trimmedValue = value.trim();

  if (
    trimmedValue.length === 0 ||
    trimmedValue === WebhookTriggerWorkspaceRootRepositoryOptionValue
  ) {
    return null;
  }

  return trimmedValue;
}

function resolveTriggerSubmissionShape(input: {
  values: WebhookTriggerFormValues;
  eventOptions: readonly WebhookTriggerEventOption[];
}): {
  integrationWebhookSourceId: string;
  eventTypes: string[] | null;
} {
  const resolvedEvents = resolveSelectedEvents({
    eventIds: input.values.eventIds,
    eventOptions: input.eventOptions,
  });

  if (resolvedEvents.connectionIds.length > 1) {
    throw new Error("All events in one trigger must come from the same integration connection.");
  }

  if (resolvedEvents.webhookSourceIds.length > 1) {
    throw new Error("All events in one trigger must come from the same webhook source.");
  }

  if (resolvedEvents.webhookSourceId === null) {
    throw new Error(
      "A valid integration webhook source could not be derived from the selected triggers.",
    );
  }

  return {
    integrationWebhookSourceId: resolvedEvents.webhookSourceId,
    eventTypes: parseOptionalEventTypes(resolvedEvents.eventTypes),
  };
}

export function toCreateWebhookTriggerPayload(
  values: WebhookTriggerFormValues,
  eventOptions: readonly WebhookTriggerEventOption[] = [],
): CreateWebhookTriggerInput {
  const resolvedSubmissionShape = resolveTriggerSubmissionShape({
    values,
    eventOptions,
  });

  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationWebhookSourceId: resolvedSubmissionShape.integrationWebhookSourceId,
    inputTemplate: values.inputTemplate.trim(),
    instructions: values.instructions.trim().length === 0 ? null : values.instructions.trim(),
    conversationKeyTemplate: values.conversationKeyTemplate,
    idempotencyKeyTemplate: null,
    eventTypes: resolvedSubmissionShape.eventTypes,
    payloadFilter: toPayloadFilterValue({ values, eventOptions }),
    target: {
      sandboxProfileId: values.sandboxProfileId,
      primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
    },
  };
}

export function toUpdateWebhookTriggerPayload(
  values: WebhookTriggerFormValues,
  eventOptions: readonly WebhookTriggerEventOption[] = [],
): UpdateWebhookTriggerPatch {
  const resolvedSubmissionShape = resolveTriggerSubmissionShape({
    values,
    eventOptions,
  });

  return {
    name: values.name.trim(),
    enabled: values.enabled,
    integrationWebhookSourceId: resolvedSubmissionShape.integrationWebhookSourceId,
    inputTemplate: values.inputTemplate.trim(),
    instructions: values.instructions.trim().length === 0 ? null : values.instructions.trim(),
    conversationKeyTemplate: values.conversationKeyTemplate,
    idempotencyKeyTemplate: null,
    eventTypes: resolvedSubmissionShape.eventTypes,
    payloadFilter: toPayloadFilterValue({ values, eventOptions }),
    target: {
      sandboxProfileId: values.sandboxProfileId,
      primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
    },
  };
}
