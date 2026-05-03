export type ScheduledAutomationFormOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
};

export const ScheduledAutomationConversationModes = {
  SAME: "same",
  NEW_EACH_RUN: "new_each_run",
} as const;

export type ScheduledAutomationConversationMode =
  (typeof ScheduledAutomationConversationModes)[keyof typeof ScheduledAutomationConversationModes];

export type ScheduledAutomationFormValues = {
  name: string;
  sandboxProfileId: string;
  primaryRepositoryId: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  conversationMode: ScheduledAutomationConversationMode;
  inputTemplate: string;
};

export type ScheduledAutomationFormValueKey = keyof ScheduledAutomationFormValues;
