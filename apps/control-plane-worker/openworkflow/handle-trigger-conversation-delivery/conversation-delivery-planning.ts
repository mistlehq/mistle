export const TriggerConversationDeliverySandboxActions = {
  REUSE_EXISTING: "reuse_existing",
  START_NEW: "start_new",
  FAIL: "fail",
} as const;

export type ConversationDeliverySandboxAction =
  (typeof TriggerConversationDeliverySandboxActions)[keyof typeof TriggerConversationDeliverySandboxActions];

export function resolveTriggerConversationDeliverySandboxAction(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: "pending" | "starting" | "running" | "stopped" | "failed" | null;
}): ConversationDeliverySandboxAction {
  if (input.sandboxInstanceId === null) {
    return TriggerConversationDeliverySandboxActions.START_NEW;
  }
  if (
    input.sandboxStatus === "pending" ||
    input.sandboxStatus === "starting" ||
    input.sandboxStatus === "running" ||
    input.sandboxStatus === "stopped"
  ) {
    return TriggerConversationDeliverySandboxActions.REUSE_EXISTING;
  }

  return TriggerConversationDeliverySandboxActions.FAIL;
}

export const TriggerConversationRouteBindingActions = {
  CREATE_ROUTE: "create_route",
  ACTIVATE_PENDING_ROUTE: "activate_pending_route",
  REUSE_ACTIVE_ROUTE: "reuse_active_route",
  FAIL_SANDBOX_MISMATCH: "fail_sandbox_mismatch",
} as const;

export type TriggerConversationRouteBindingAction =
  (typeof TriggerConversationRouteBindingActions)[keyof typeof TriggerConversationRouteBindingActions];

export function resolveTriggerConversationRouteBindingAction(input: {
  routeId: string | null;
  routeSandboxInstanceId: string | null;
  providerConversationId: string | null;
  ensuredSandboxInstanceId: string;
}): TriggerConversationRouteBindingAction {
  if (input.routeId === null) {
    return TriggerConversationRouteBindingActions.CREATE_ROUTE;
  }
  if (input.routeSandboxInstanceId !== input.ensuredSandboxInstanceId) {
    return TriggerConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH;
  }
  if (input.providerConversationId === null) {
    return TriggerConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE;
  }

  return TriggerConversationRouteBindingActions.REUSE_ACTIVE_ROUTE;
}
