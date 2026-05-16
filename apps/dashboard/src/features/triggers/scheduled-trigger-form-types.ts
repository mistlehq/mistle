export type ScheduledTriggerFormOption = {
  value: string;
  label: string;
  description?: string;
  path?: string;
  sandboxProfileDisplayName?: string;
  sandboxProfileVersion?: number | null;
};

export const ScheduledTriggerConversationModes = {
  SAME: "same",
  NEW_EACH_RUN: "new_each_run",
} as const;

export type ScheduledTriggerConversationMode =
  (typeof ScheduledTriggerConversationModes)[keyof typeof ScheduledTriggerConversationModes];

export type ScheduledTriggerFormValues = {
  name: string;
  sandboxProfileId: string;
  primaryRepositoryId: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  conversationMode: ScheduledTriggerConversationMode;
  inputTemplate: string;
};

export type ScheduledTriggerFormValueKey = keyof ScheduledTriggerFormValues;
