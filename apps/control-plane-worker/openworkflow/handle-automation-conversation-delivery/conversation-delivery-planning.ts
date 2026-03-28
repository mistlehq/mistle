export const AutomationConversationDeliverySandboxActions = {
  REUSE_EXISTING: "reuse_existing",
  START_NEW: "start_new",
  FAIL: "fail",
} as const;

export type ConversationDeliverySandboxAction =
  (typeof AutomationConversationDeliverySandboxActions)[keyof typeof AutomationConversationDeliverySandboxActions];

export function resolveAutomationConversationDeliverySandboxAction(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: "pending" | "starting" | "running" | "stopped" | "failed" | null;
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
