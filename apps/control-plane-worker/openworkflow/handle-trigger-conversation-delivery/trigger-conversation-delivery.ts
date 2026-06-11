import type { ProviderInspectConversationOutput } from "../shared/provider-adapter.js";

export const TriggerConversationExecutionActions = {
  START: "start",
  STEER: "steer",
  FAIL_MISSING_CONVERSATION: "fail_missing_conversation",
  FAIL_NOT_LOADED: "fail_not_loaded",
  FAIL_PROVIDER_ERROR: "fail_provider_error",
  FAIL_MISSING_EXECUTION: "fail_missing_execution",
} as const;

export type ConversationExecutionAction =
  (typeof TriggerConversationExecutionActions)[keyof typeof TriggerConversationExecutionActions];

export function resolveTriggerConversationExecutionAction(input: {
  inspectTriggerConversation: ProviderInspectConversationOutput;
  providerExecutionId: string | null;
}): ConversationExecutionAction {
  if (!input.inspectTriggerConversation.exists) {
    return TriggerConversationExecutionActions.FAIL_MISSING_CONVERSATION;
  }
  if (input.inspectTriggerConversation.status === "not_loaded") {
    return TriggerConversationExecutionActions.FAIL_NOT_LOADED;
  }
  if (input.inspectTriggerConversation.status === "error") {
    return TriggerConversationExecutionActions.FAIL_PROVIDER_ERROR;
  }
  if (input.inspectTriggerConversation.status === "idle") {
    return TriggerConversationExecutionActions.START;
  }
  if (input.providerExecutionId === null) {
    return TriggerConversationExecutionActions.FAIL_MISSING_EXECUTION;
  }
  return TriggerConversationExecutionActions.STEER;
}

export const TriggerConversationSteerRecoveryActions = {
  START: "start",
  FAIL_MISSING_CONVERSATION: "fail_missing_conversation",
  FAIL_NOT_LOADED: "fail_not_loaded",
  FAIL_PROVIDER_ERROR: "fail_provider_error",
  FAIL_STILL_ACTIVE: "fail_still_active",
} as const;

export type ConversationSteerRecoveryAction =
  (typeof TriggerConversationSteerRecoveryActions)[keyof typeof TriggerConversationSteerRecoveryActions];

export function resolveTriggerConversationSteerRecoveryAction(input: {
  inspectTriggerConversation: ProviderInspectConversationOutput;
}): ConversationSteerRecoveryAction {
  if (!input.inspectTriggerConversation.exists) {
    return TriggerConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION;
  }
  if (input.inspectTriggerConversation.status === "not_loaded") {
    return TriggerConversationSteerRecoveryActions.FAIL_NOT_LOADED;
  }
  if (input.inspectTriggerConversation.status === "error") {
    return TriggerConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR;
  }
  if (input.inspectTriggerConversation.status === "idle") {
    return TriggerConversationSteerRecoveryActions.START;
  }

  return TriggerConversationSteerRecoveryActions.FAIL_STILL_ACTIVE;
}
