import type {
  ProviderInspectConversationOutput,
  ConversationProviderAdapter,
} from "../automation-conversations/provider-adapter.js";
import {
  type ConversationProviderErrorCode,
  ConversationProviderErrorCodes,
} from "../automation-conversations/provider-errors.js";

export const AutomationConversationDeliverySandboxActions = {
  REUSE_EXISTING: "reuse_existing",
  START_NEW: "start_new",
  FAIL: "fail",
} as const;

export type ConversationDeliverySandboxAction =
  (typeof AutomationConversationDeliverySandboxActions)[keyof typeof AutomationConversationDeliverySandboxActions];

export function resolveAutomationConversationDeliverySandboxAction(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
}): ConversationDeliverySandboxAction {
  if (input.sandboxInstanceId === null) {
    return AutomationConversationDeliverySandboxActions.START_NEW;
  }
  if (input.sandboxStatus === "running") {
    return AutomationConversationDeliverySandboxActions.REUSE_EXISTING;
  }

  return AutomationConversationDeliverySandboxActions.FAIL;
}

export const AutomationConversationRouteBindingActions = {
  CREATE_ROUTE: "create_route",
  ACTIVATE_PENDING_ROUTE: "activate_pending_route",
  REUSE_ACTIVE_ROUTE: "reuse_active_route",
  FAIL_SANDBOX_MISMATCH: "fail_sandbox_mismatch",
} as const;

export type AutomationConversationRouteBindingAction =
  (typeof AutomationConversationRouteBindingActions)[keyof typeof AutomationConversationRouteBindingActions];

export function resolveAutomationConversationRouteBindingAction(input: {
  routeId: string | null;
  routeSandboxInstanceId: string | null;
  providerConversationId: string | null;
  ensuredSandboxInstanceId: string;
}): AutomationConversationRouteBindingAction {
  if (input.routeId === null) {
    return AutomationConversationRouteBindingActions.CREATE_ROUTE;
  }
  if (input.routeSandboxInstanceId !== input.ensuredSandboxInstanceId) {
    return AutomationConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH;
  }
  if (input.providerConversationId === null) {
    return AutomationConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE;
  }

  return AutomationConversationRouteBindingActions.REUSE_ACTIVE_ROUTE;
}

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
  adapter: Pick<ConversationProviderAdapter, "steerExecution">;
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
