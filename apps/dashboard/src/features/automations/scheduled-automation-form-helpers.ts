import type {
  ScheduledAutomationConversationMode,
  ScheduledAutomationFormOption,
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
import { ScheduledAutomationConversationModes } from "./scheduled-automation-form-types.js";
import type {
  CreateScheduledAutomationInput,
  ScheduledAutomation,
  UpdateScheduledAutomationPatch,
} from "./scheduled-automations-types.js";
import { WebhookAutomationWorkspaceRootRepositoryOptionValue } from "./webhook-automation-option-builders.js";

export const DefaultScheduledAutomationCronExpression = "0 9 * * *";
export const ScheduledAutomationSameConversationKeyTemplate = "{{schedule.id}}";
export const ScheduledAutomationNewConversationEachRunKeyTemplate =
  "{{schedule.scheduledActionId}}";
export const ScheduledAutomationConversationOptions = [
  {
    value: ScheduledAutomationConversationModes.SAME,
    label: "Schedule",
    description: "Every run from this schedule goes to one conversation.",
  },
  {
    value: ScheduledAutomationConversationModes.NEW_EACH_RUN,
    label: "Run",
    description: "Each scheduled run starts its own conversation.",
  },
] satisfies readonly ScheduledAutomationFormOption[];

export function readBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
}

function toPrimaryRepositoryId(value: string): string | null {
  const trimmedValue = value.trim();

  if (
    trimmedValue.length === 0 ||
    trimmedValue === WebhookAutomationWorkspaceRootRepositoryOptionValue
  ) {
    return null;
  }

  return trimmedValue;
}

function toConversationMode(conversationKeyTemplate: string): ScheduledAutomationConversationMode {
  if (conversationKeyTemplate === ScheduledAutomationSameConversationKeyTemplate) {
    return ScheduledAutomationConversationModes.SAME;
  }

  if (conversationKeyTemplate === ScheduledAutomationNewConversationEachRunKeyTemplate) {
    return ScheduledAutomationConversationModes.NEW_EACH_RUN;
  }

  throw new Error(`Unsupported scheduled automation conversation key template.`);
}

function toConversationKeyTemplate(conversationMode: ScheduledAutomationConversationMode): string {
  if (conversationMode === ScheduledAutomationConversationModes.SAME) {
    return ScheduledAutomationSameConversationKeyTemplate;
  }

  if (conversationMode === ScheduledAutomationConversationModes.NEW_EACH_RUN) {
    return ScheduledAutomationNewConversationEachRunKeyTemplate;
  }

  throw new Error(`Unsupported scheduled automation conversation mode.`);
}

export function toScheduledAutomationFormValues(
  automation: ScheduledAutomation | null,
): ScheduledAutomationFormValues {
  if (automation === null) {
    return {
      name: "",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      cronExpression: DefaultScheduledAutomationCronExpression,
      timezone: readBrowserTimezone(),
      conversationMode: ScheduledAutomationConversationModes.SAME,
      inputTemplate: "",
    };
  }

  return {
    name: automation.name,
    sandboxProfileId: automation.target.sandboxProfileId,
    primaryRepositoryId: automation.target.primaryRepositoryId ?? "",
    enabled: automation.enabled,
    cronExpression: automation.schedule.cronExpression,
    timezone: automation.schedule.timezone,
    conversationMode: toConversationMode(automation.conversationKeyTemplate),
    inputTemplate: automation.inputTemplate,
  };
}

export function validateScheduledAutomationFormValues(
  values: ScheduledAutomationFormValues,
): Partial<Record<ScheduledAutomationFormValueKey, string>> {
  const errors: Partial<Record<ScheduledAutomationFormValueKey, string>> = {};

  if (values.name.trim().length === 0) {
    errors.name = "Automation name is required.";
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

export function toCreateScheduledAutomationPayload(
  values: ScheduledAutomationFormValues,
): CreateScheduledAutomationInput {
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

function hasScheduledAutomationTargetChanged(input: {
  values: ScheduledAutomationFormValues;
  initialValues: ScheduledAutomationFormValues;
}): boolean {
  return (
    input.values.sandboxProfileId.trim() !== input.initialValues.sandboxProfileId.trim() ||
    toPrimaryRepositoryId(input.values.primaryRepositoryId) !==
      toPrimaryRepositoryId(input.initialValues.primaryRepositoryId)
  );
}

export function toUpdateScheduledAutomationPayload(
  values: ScheduledAutomationFormValues,
  input?: {
    initialValues: ScheduledAutomationFormValues;
  },
): UpdateScheduledAutomationPatch {
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
    ...(input === undefined || hasScheduledAutomationTargetChanged({ values, ...input })
      ? {
          target: {
            sandboxProfileId: values.sandboxProfileId.trim(),
            primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
          },
        }
      : {}),
  };
}
