export const ConversationPersistenceErrorCodes = {
  CONVERSATION_KEY_FORBIDDEN: "conversation_key_forbidden",
  CONVERSATION_KEY_REQUIRED: "conversation_key_required",
  CONVERSATION_CLOSED: "conversation_closed",
  CONVERSATION_NOT_FOUND: "conversation_not_found",
  CONVERSATION_ROUTE_CLOSED: "conversation_route_closed",
  CONVERSATION_ROUTE_NOT_FOUND: "conversation_route_not_found",
  CONVERSATION_ROUTE_CONVERSATION_MISMATCH: "conversation_route_conversation_mismatch",
  CONVERSATION_TITLE_MUST_BE_NULL: "conversation_title_must_be_null",
} as const;

export type ConversationPersistenceErrorCode =
  (typeof ConversationPersistenceErrorCodes)[keyof typeof ConversationPersistenceErrorCodes];

export class ConversationPersistenceError extends Error {
  readonly code: ConversationPersistenceErrorCode;

  constructor(input: { code: ConversationPersistenceErrorCode; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}
