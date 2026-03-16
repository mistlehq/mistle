import type {
  ConversationProviderAdapter,
  ProviderInspectConversationOutput,
} from "./provider-adapter.js";
import {
  type ConversationProviderErrorCode,
  ConversationProviderErrorCodes,
} from "./provider-errors.js";

export const AutomationConversationExecutionActions = {
  START: "start",
  STEER: "steer",
  FAIL_MISSING_CONVERSATION: "fail_missing_conversation",
  FAIL_PROVIDER_ERROR: "fail_provider_error",
  FAIL_MISSING_EXECUTION: "fail_missing_execution",
  FAIL_STEER_NOT_SUPPORTED: "fail_steer_not_supported",
} as const;

export type ConversationExecutionAction =
  (typeof AutomationConversationExecutionActions)[keyof typeof AutomationConversationExecutionActions];

export function resolveAutomationConversationExecutionAction(input: {
  inspectAutomationConversation: ProviderInspectConversationOutput;
  providerExecutionId: string | null;
  adapter: {
    steerExecution?: ConversationProviderAdapter["steerExecution"];
  };
}): ConversationExecutionAction {
  if (!input.inspectAutomationConversation.exists) {
    return AutomationConversationExecutionActions.FAIL_MISSING_CONVERSATION;
  }
  if (input.inspectAutomationConversation.status === "error") {
    return AutomationConversationExecutionActions.FAIL_PROVIDER_ERROR;
  }
  if (input.inspectAutomationConversation.status === "idle") {
    return AutomationConversationExecutionActions.START;
  }
  if (input.providerExecutionId === null) {
    return AutomationConversationExecutionActions.FAIL_MISSING_EXECUTION;
  }
  if (input.adapter.steerExecution === undefined) {
    return AutomationConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED;
  }

  return AutomationConversationExecutionActions.STEER;
}

export const AutomationConversationSteerRecoveryActions = {
  START: "start",
  FAIL_MISSING_CONVERSATION: "fail_missing_conversation",
  FAIL_PROVIDER_ERROR: "fail_provider_error",
  FAIL_STILL_ACTIVE: "fail_still_active",
} as const;

export type ConversationSteerRecoveryAction =
  (typeof AutomationConversationSteerRecoveryActions)[keyof typeof AutomationConversationSteerRecoveryActions];

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

export function resolveAutomationConversationSteerRecoveryAction(input: {
  inspectAutomationConversation: ProviderInspectConversationOutput;
}): ConversationSteerRecoveryAction {
  if (!input.inspectAutomationConversation.exists) {
    return AutomationConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION;
  }
  if (input.inspectAutomationConversation.status === "error") {
    return AutomationConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR;
  }
  if (input.inspectAutomationConversation.status === "idle") {
    return AutomationConversationSteerRecoveryActions.START;
  }

  return AutomationConversationSteerRecoveryActions.FAIL_STILL_ACTIVE;
}
