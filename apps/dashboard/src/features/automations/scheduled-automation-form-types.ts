export type ScheduledAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
};

export type ScheduledAutomationFormValues = {
  name: string;
  sandboxProfileId: string;
  primaryRepositoryId: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  inputTemplate: string;
};

export type ScheduledAutomationFormValueKey = keyof ScheduledAutomationFormValues;
