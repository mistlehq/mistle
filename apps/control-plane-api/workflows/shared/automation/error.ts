export const AutomationRunFailureCodes = {
  AUTOMATION_RUN_NOT_FOUND: "automation_run_not_found",
  AUTOMATION_NOT_FOUND: "automation_not_found",
  AUTOMATION_TARGET_REFERENCE_MISSING: "automation_target_reference_missing",
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_AUTOMATION_NOT_FOUND: "webhook_automation_not_found",
  AGENT_BINDING_NOT_FOUND: "agent_binding_not_found",
  AGENT_BINDING_AMBIGUOUS: "agent_binding_ambiguous",
  AGENT_BINDING_CONNECTION_NOT_FOUND: "agent_binding_connection_not_found",
  AGENT_BINDING_TARGET_NOT_FOUND: "agent_binding_target_not_found",
  WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING: "webhook_event_source_order_key_missing",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
  AUTOMATION_RUN_EXECUTION_FAILED: "automation_run_execution_failed",
} as const;

export const AutomationConversationPersistenceErrorCodes = {
  CONVERSATION_KEY_FORBIDDEN: "conversation_key_forbidden",
  CONVERSATION_KEY_REQUIRED: "conversation_key_required",
  CONVERSATION_CLOSED: "conversation_closed",
  CONVERSATION_DELIVERY_PROCESSOR_NOT_FOUND: "conversation_delivery_processor_not_found",
  CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH: "conversation_delivery_task_input_mismatch",
  CONVERSATION_DELIVERY_TASK_NOT_FOUND: "conversation_delivery_task_not_found",
  CONVERSATION_NOT_FOUND: "conversation_not_found",
  CONVERSATION_TITLE_MUST_BE_NULL: "conversation_title_must_be_null",
} as const;

export type AutomationRunFailureCode =
  (typeof AutomationRunFailureCodes)[keyof typeof AutomationRunFailureCodes];

export type AutomationConversationPersistenceErrorCode =
  (typeof AutomationConversationPersistenceErrorCodes)[keyof typeof AutomationConversationPersistenceErrorCodes];

export class AutomationRunExecutionError extends Error {
  readonly code: AutomationRunFailureCode;

  constructor(input: { code: AutomationRunFailureCode; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

export class AutomationConversationPersistenceError extends Error {
  readonly code: AutomationConversationPersistenceErrorCode;

  constructor(input: {
    code: AutomationConversationPersistenceErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

export function resolveAutomationRunFailure(input: unknown): {
  code: AutomationRunFailureCode;
  message: string;
} {
  if (input instanceof AutomationRunExecutionError) {
    return {
      code: input.code,
      message: input.message,
    };
  }

  if (input instanceof Error) {
    return {
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: input.message,
    };
  }

  return {
    code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
    message: "Automation run execution failed with a non-error exception.",
  };
}
