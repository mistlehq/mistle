export const TriggerConversationPersistenceErrorCodes = {
  CONVERSATION_KEY_FORBIDDEN: "conversation_key_forbidden",
  CONVERSATION_KEY_REQUIRED: "conversation_key_required",
  CONVERSATION_CLOSED: "conversation_closed",
  CONVERSATION_DELIVERY_PROCESSOR_NOT_FOUND: "conversation_delivery_processor_not_found",
  CONVERSATION_DELIVERY_TASK_ACTIVE_NOT_FOUND: "conversation_delivery_task_active_not_found",
  CONVERSATION_DELIVERY_TASK_INPUT_MISMATCH: "conversation_delivery_task_input_mismatch",
  CONVERSATION_DELIVERY_TASK_NOT_FOUND: "conversation_delivery_task_not_found",
  CONVERSATION_DELIVERY_TASK_NOT_ACTIVE: "conversation_delivery_task_not_active",
  CONVERSATION_DELIVERY_TASK_NOT_CLAIMED: "conversation_delivery_task_not_claimed",
  CONVERSATION_NOT_FOUND: "conversation_not_found",
  CONVERSATION_ROUTE_CLOSED: "conversation_route_closed",
  CONVERSATION_ROUTE_NOT_FOUND: "conversation_route_not_found",
  CONVERSATION_ROUTE_CONVERSATION_MISMATCH: "conversation_route_conversation_mismatch",
} as const;

export type TriggerConversationPersistenceErrorCode =
  (typeof TriggerConversationPersistenceErrorCodes)[keyof typeof TriggerConversationPersistenceErrorCodes];

export class TriggerConversationPersistenceError extends Error {
  readonly code: TriggerConversationPersistenceErrorCode;

  constructor(input: {
    code: TriggerConversationPersistenceErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}
