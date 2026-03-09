import type {
  ProviderInspectConversationOutput,
  ConversationProviderAdapter,
} from "../conversations/provider-adapter.js";

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
