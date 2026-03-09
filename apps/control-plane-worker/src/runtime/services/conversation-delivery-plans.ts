import type {
  ProviderInspectConversationOutput,
  ConversationProviderAdapter,
} from "../conversations/provider-adapter.js";
import {
  type ConversationProviderErrorCode,
  ConversationProviderErrorCodes,
} from "../conversations/provider-errors.js";

export const ConversationDeliverySandboxActions = {
  REUSE_EXISTING: "reuse_existing",
  START_NEW: "start_new",
  FAIL: "fail",
} as const;

export type ConversationDeliverySandboxAction =
  (typeof ConversationDeliverySandboxActions)[keyof typeof ConversationDeliverySandboxActions];

export function resolveConversationDeliverySandboxAction(input: {
  sandboxInstanceId: string | null;
  providerConversationId: string | null;
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
}): ConversationDeliverySandboxAction {
  if (input.sandboxInstanceId === null) {
    return ConversationDeliverySandboxActions.START_NEW;
  }
  if (input.sandboxStatus === "running") {
    return ConversationDeliverySandboxActions.REUSE_EXISTING;
  }
  if (input.providerConversationId !== null) {
    return ConversationDeliverySandboxActions.FAIL;
  }

  return ConversationDeliverySandboxActions.START_NEW;
}

export const ConversationExecutionActions = {
  START: "start",
  STEER: "steer",
  FAIL_MISSING_CONVERSATION: "fail_missing_conversation",
  FAIL_PROVIDER_ERROR: "fail_provider_error",
  FAIL_MISSING_EXECUTION: "fail_missing_execution",
  FAIL_STEER_NOT_SUPPORTED: "fail_steer_not_supported",
} as const;

export type ConversationExecutionAction =
  (typeof ConversationExecutionActions)[keyof typeof ConversationExecutionActions];

export function resolveConversationExecutionAction(input: {
  inspectConversation: ProviderInspectConversationOutput;
  providerExecutionId: string | null;
  adapter: Pick<ConversationProviderAdapter, "steerExecution">;
}): ConversationExecutionAction {
  if (!input.inspectConversation.exists) {
    return ConversationExecutionActions.FAIL_MISSING_CONVERSATION;
  }
  if (input.inspectConversation.status === "error") {
    return ConversationExecutionActions.FAIL_PROVIDER_ERROR;
  }
  if (input.inspectConversation.status === "idle") {
    return ConversationExecutionActions.START;
  }
  if (input.providerExecutionId === null) {
    return ConversationExecutionActions.FAIL_MISSING_EXECUTION;
  }
  if (input.adapter.steerExecution === undefined) {
    return ConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED;
  }

  return ConversationExecutionActions.STEER;
}

export const ConversationSteerRecoveryActions = {
  START: "start",
  FAIL_MISSING_CONVERSATION: "fail_missing_conversation",
  FAIL_PROVIDER_ERROR: "fail_provider_error",
  FAIL_STILL_ACTIVE: "fail_still_active",
} as const;

export type ConversationSteerRecoveryAction =
  (typeof ConversationSteerRecoveryActions)[keyof typeof ConversationSteerRecoveryActions];

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

export function resolveConversationSteerRecoveryAction(input: {
  inspectConversation: ProviderInspectConversationOutput;
}): ConversationSteerRecoveryAction {
  if (!input.inspectConversation.exists) {
    return ConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION;
  }
  if (input.inspectConversation.status === "error") {
    return ConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR;
  }
  if (input.inspectConversation.status === "idle") {
    return ConversationSteerRecoveryActions.START;
  }

  return ConversationSteerRecoveryActions.FAIL_STILL_ACTIVE;
}
