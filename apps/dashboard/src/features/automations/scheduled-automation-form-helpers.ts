import type {
  ScheduledAutomationFormValueKey,
  ScheduledAutomationFormValues,
} from "./scheduled-automation-form-types.js";
import type {
  CreateScheduledAutomationInput,
  ScheduledAutomation,
  UpdateScheduledAutomationPatch,
} from "./scheduled-automations-types.js";
import { WebhookAutomationWorkspaceRootRepositoryOptionValue } from "./webhook-automation-option-builders.js";

export const DefaultScheduledAutomationCronExpression = "0 9 * * *";
export const DefaultScheduledAutomationTimezone = "UTC";
export const DefaultScheduledAutomationMessageTemplate = "Run the scheduled automation.";

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
      timezone: DefaultScheduledAutomationTimezone,
      inputTemplate: DefaultScheduledAutomationMessageTemplate,
    };
  }

  return {
    name: automation.name,
    sandboxProfileId: automation.target.sandboxProfileId,
    primaryRepositoryId: automation.target.primaryRepositoryId ?? "",
    enabled: automation.enabled,
    cronExpression: automation.schedule.cronExpression,
    timezone: automation.schedule.timezone,
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
    errors.inputTemplate = "Message template is required.";
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
    inputTemplate: values.inputTemplate.trim(),
    target: {
      sandboxProfileId: values.sandboxProfileId.trim(),
      primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
    },
  };
}

export function toUpdateScheduledAutomationPayload(
  values: ScheduledAutomationFormValues,
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
    inputTemplate: values.inputTemplate.trim(),
    target: {
      sandboxProfileId: values.sandboxProfileId.trim(),
      primaryRepositoryId: toPrimaryRepositoryId(values.primaryRepositoryId),
    },
  };
}
