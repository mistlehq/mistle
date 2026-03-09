export const ConversationProviderErrorCodes = {
  PROVIDER_CONVERSATION_MISSING: "provider_conversation_missing",
  PROVIDER_CREATE_CONVERSATION_FAILED: "provider_create_conversation_failed",
  PROVIDER_EXECUTION_MISSING: "provider_execution_missing",
  PROVIDER_INSPECT_FAILED: "provider_inspect_failed",
  PROVIDER_REQUEST_FAILED: "provider_request_failed",
  PROVIDER_RESUME_FAILED: "provider_resume_failed",
  PROVIDER_START_EXECUTION_FAILED: "provider_start_execution_failed",
  PROVIDER_STEER_EXECUTION_FAILED: "provider_steer_execution_failed",
  PROVIDER_STEER_NOT_SUPPORTED: "provider_steer_not_supported",
} as const;

export type ConversationProviderErrorCode =
  (typeof ConversationProviderErrorCodes)[keyof typeof ConversationProviderErrorCodes];

export class ConversationProviderError extends Error {
  readonly code: ConversationProviderErrorCode;

  constructor(input: { code: ConversationProviderErrorCode; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}
