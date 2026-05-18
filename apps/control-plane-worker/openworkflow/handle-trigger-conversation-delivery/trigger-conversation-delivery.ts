import type {
  ConversationProviderAdapter,
  ProviderInspectConversationOutput,
} from "./provider-adapter.js";
import {
  type ConversationProviderErrorCode,
  ConversationProviderErrorCodes,
} from "./provider-errors.js";

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
  adapter: Pick<ConversationProviderAdapter, "steerExecution">;
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

function isConversationProviderErrorLike(
  value: unknown,
): value is Pick<Error, "message"> & { code?: ConversationProviderErrorCode } {
  return (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string" &&
    (!("code" in value) || typeof value.code === "string")
  );
}

export function isRecoverableLateSteerError(input: { error: unknown }): boolean {
  if (!isConversationProviderErrorLike(input.error)) {
    return false;
  }

  return (
    input.error.code === ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING &&
    input.error.message.includes("no active turn to steer")
  );
}

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
