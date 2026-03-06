export const SandboxConversationsBadRequestCodes = {
  INTEGRATION_BINDING_PROFILE_MISMATCH: "INTEGRATION_BINDING_PROFILE_MISMATCH",
  INTEGRATION_BINDING_INVALID: "INTEGRATION_BINDING_INVALID",
  CONVERSATION_OWNER_UNSUPPORTED: "CONVERSATION_OWNER_UNSUPPORTED",
  AUTOMATION_TARGET_PROFILE_VERSION_MISSING: "AUTOMATION_TARGET_PROFILE_VERSION_MISSING",
} as const;

export type SandboxConversationsBadRequestCode =
  (typeof SandboxConversationsBadRequestCodes)[keyof typeof SandboxConversationsBadRequestCodes];

export class SandboxConversationsBadRequestError extends Error {
  readonly code: SandboxConversationsBadRequestCode;

  constructor(code: SandboxConversationsBadRequestCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const SandboxConversationsNotFoundCodes = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  PROFILE_VERSION_NOT_FOUND: "PROFILE_VERSION_NOT_FOUND",
  INTEGRATION_BINDING_NOT_FOUND: "INTEGRATION_BINDING_NOT_FOUND",
  AUTOMATION_TARGET_NOT_FOUND: "AUTOMATION_TARGET_NOT_FOUND",
  CONVERSATION_NOT_FOUND: "CONVERSATION_NOT_FOUND",
  CONVERSATION_ROUTE_NOT_FOUND: "CONVERSATION_ROUTE_NOT_FOUND",
  CONVERSATION_SNAPSHOT_MISSING: "conversation_snapshot_missing",
} as const;

export type SandboxConversationsNotFoundCode =
  (typeof SandboxConversationsNotFoundCodes)[keyof typeof SandboxConversationsNotFoundCodes];

export class SandboxConversationsNotFoundError extends Error {
  readonly code: SandboxConversationsNotFoundCode;

  constructor(code: SandboxConversationsNotFoundCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const SandboxConversationsConflictCodes = {
  CONVERSATION_CLOSED: "conversation_closed",
  CONVERSATION_ROUTE_CLOSED: "conversation_route_closed",
  CONVERSATION_RECOVERY_FAILED: "conversation_recovery_failed",
} as const;

export type SandboxConversationsConflictCode =
  (typeof SandboxConversationsConflictCodes)[keyof typeof SandboxConversationsConflictCodes];

export class SandboxConversationsConflictError extends Error {
  readonly code: SandboxConversationsConflictCode;

  constructor(code: SandboxConversationsConflictCode, message: string) {
    super(message);
    this.code = code;
  }
}
