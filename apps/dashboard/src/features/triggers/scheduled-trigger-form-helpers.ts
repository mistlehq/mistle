import type {
  ScheduledTriggerConversationMode,
  ScheduledTriggerFormOption,
  ScheduledTriggerFormValueKey,
  ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
import { ScheduledTriggerConversationModes } from "./scheduled-trigger-form-types.js";
import type {
  CreateScheduledTriggerInput,
  ScheduledTrigger,
  UpdateScheduledTriggerPatch,
} from "./scheduled-triggers-types.js";
import { WebhookTriggerWorkspaceRootRepositoryOptionValue } from "./webhook-trigger-option-builders.js";

export const DefaultScheduledTriggerCronExpression = "0 9 * * *";
export const ScheduledTriggerSameConversationKeyTemplate = "{{schedule.id}}";
export const ScheduledTriggerNewConversationEachRunKeyTemplate = "{{schedule.scheduledActionId}}";
export const ScheduledTriggerConversationOptions = [
  {
    value: ScheduledTriggerConversationModes.SAME,
    label: "Schedule",
    description: "Every run from this schedule goes to one conversation.",
  },
  {
    value: ScheduledTriggerConversationModes.NEW_EACH_RUN,
    label: "Run",
    description: "Each scheduled run starts its own conversation.",
  },
] satisfies readonly ScheduledTriggerFormOption[];

export function readBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
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

function toConversationMode(conversationKeyTemplate: string): ScheduledTriggerConversationMode {
  if (conversationKeyTemplate === ScheduledTriggerSameConversationKeyTemplate) {
    return ScheduledTriggerConversationModes.SAME;
  }

  if (conversationKeyTemplate === ScheduledTriggerNewConversationEachRunKeyTemplate) {
    return ScheduledTriggerConversationModes.NEW_EACH_RUN;
  }

  throw new Error(`Unsupported scheduled trigger conversation key template.`);
}

function toConversationKeyTemplate(conversationMode: ScheduledTriggerConversationMode): string {
  if (conversationMode === ScheduledTriggerConversationModes.SAME) {
    return ScheduledTriggerSameConversationKeyTemplate;
  }

  if (conversationMode === ScheduledTriggerConversationModes.NEW_EACH_RUN) {
    return ScheduledTriggerNewConversationEachRunKeyTemplate;
  }

  throw new Error(`Unsupported scheduled trigger conversation mode.`);
}

export function toScheduledTriggerFormValues(
  trigger: ScheduledTrigger | null,
): ScheduledTriggerFormValues {
  if (trigger === null) {
    return {
      name: "",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      cronExpression: DefaultScheduledTriggerCronExpression,
      timezone: readBrowserTimezone(),
      conversationMode: ScheduledTriggerConversationModes.SAME,
      inputTemplate: "",
    };
  }

  if (trigger.schedule.kind !== "recurring") {
    throw new Error("Only recurring scheduled triggers can be edited in this form.");
  }

  return {
    name: trigger.name,
    sandboxProfileId: trigger.target.sandboxProfileId,
    primaryRepositoryId: trigger.target.primaryRepositoryId ?? "",
    enabled: trigger.enabled,
    cronExpression: trigger.schedule.cronExpression,
    timezone: trigger.schedule.timezone,
    conversationMode: toConversationMode(trigger.conversationKeyTemplate),
    inputTemplate: trigger.inputTemplate,
  };
}

export function validateScheduledTriggerFormValues(
  values: ScheduledTriggerFormValues,
): Partial<Record<ScheduledTriggerFormValueKey, string>> {
  const errors: Partial<Record<ScheduledTriggerFormValueKey, string>> = {};

  if (values.name.trim().length === 0) {
    errors.name = "Trigger name is required.";
  }

  if (values.sandboxProfileId.trim().length === 0) {
    errors.sandboxProfileId = "Select a sandbox profile.";
  }

  if (values.cronExpression.trim().length === 0) {
    errors.cronExpression = "Cron expression is required.";
  }

  if (values.timezone.trim().length === 0) {
    errors.timezone = "Timezone is required.";
  }

  if (values.inputTemplate.trim().length === 0) {
    errors.inputTemplate = "User message is required.";
  }

  return errors;
}

export function toCreateScheduledTriggerPayload(
  values: ScheduledTriggerFormValues,
): CreateScheduledTriggerInput {
  const name = values.name.trim();
  const cronExpression = values.cronExpression.trim();
  const timezone = values.timezone.trim();

  return {
    name,
    enabled: values.enabled,
    schedule: {
      name,
      cronExpression,
      timezone,
    },
    conversationKeyTemplate: toConversationKeyTemplate(values.conversationMode),
    inputTemplate: values.inputTemplate.trim(),
    target: {
      sandboxProfileId: values.sandboxProfileId.trim(),
      primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
    },
  };
}

function hasScheduledTriggerTargetChanged(input: {
  values: ScheduledTriggerFormValues;
  initialValues: ScheduledTriggerFormValues;
}): boolean {
  return (
    input.values.sandboxProfileId.trim() !== input.initialValues.sandboxProfileId.trim() ||
    toPrimaryRepositoryId(input.values.primaryRepositoryId) !==
      toPrimaryRepositoryId(input.initialValues.primaryRepositoryId)
  );
}

export function toUpdateScheduledTriggerPayload(
  values: ScheduledTriggerFormValues,
  input?: {
    initialValues: ScheduledTriggerFormValues;
  },
): UpdateScheduledTriggerPatch {
  const name = values.name.trim();

  return {
    name,
    enabled: values.enabled,
    schedule: {
      name,
      cronExpression: values.cronExpression.trim(),
      timezone: values.timezone.trim(),
    },
    conversationKeyTemplate: toConversationKeyTemplate(values.conversationMode),
    inputTemplate: values.inputTemplate.trim(),
    ...(input === undefined || hasScheduledTriggerTargetChanged({ values, ...input })
      ? {
          target: {
            sandboxProfileId: values.sandboxProfileId.trim(),
            primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
          },
        }
      : {}),
  };
}
