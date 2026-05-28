import {
  getSandboxDeliveryDisposition,
  SandboxDeliveryDispositions,
  type SandboxInstanceStatus,
} from "@mistle/sandbox-lifecycle";

export const TriggerConversationDeliverySandboxActions = {
  REUSE_EXISTING: "reuse_existing",
  START_NEW: "start_new",
  RECOVER_FAILED: "recover_failed",
  FAIL: "fail",
} as const;

export type ConversationDeliverySandboxAction =
  (typeof TriggerConversationDeliverySandboxActions)[keyof typeof TriggerConversationDeliverySandboxActions];

export function resolveTriggerConversationDeliverySandboxAction(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: SandboxInstanceStatus | null;
}): ConversationDeliverySandboxAction {
  if (input.sandboxInstanceId === null) {
    return TriggerConversationDeliverySandboxActions.START_NEW;
  }

  if (input.sandboxStatus === null) {
    return TriggerConversationDeliverySandboxActions.FAIL;
  }

  switch (getSandboxDeliveryDisposition(input.sandboxStatus)) {
    case SandboxDeliveryDispositions.DELIVER:
    case SandboxDeliveryDispositions.WAIT:
    case SandboxDeliveryDispositions.RESUME:
    case SandboxDeliveryDispositions.NON_DELIVERABLE:
      return TriggerConversationDeliverySandboxActions.REUSE_EXISTING;
    case SandboxDeliveryDispositions.RECOVER:
      return TriggerConversationDeliverySandboxActions.RECOVER_FAILED;
  }
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
