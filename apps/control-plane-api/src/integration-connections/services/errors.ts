export const IntegrationConnectionsBadRequestCodes = {
  INVALID_LIST_CONNECTIONS_INPUT: "INVALID_LIST_CONNECTIONS_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
  INVALID_LIST_CONNECTION_RESOURCES_INPUT: "INVALID_LIST_CONNECTION_RESOURCES_INPUT",
  INVALID_RESOURCE_PAGINATION_CURSOR: "INVALID_RESOURCE_PAGINATION_CURSOR",
  RESOURCE_KIND_NOT_SUPPORTED: "RESOURCE_KIND_NOT_SUPPORTED",
  INVALID_CREATE_CONNECTION_INPUT: "INVALID_CREATE_CONNECTION_INPUT",
  INVALID_UPDATE_CONNECTION_INPUT: "INVALID_UPDATE_CONNECTION_INPUT",
  API_KEY_NOT_SUPPORTED: "API_KEY_NOT_SUPPORTED",
  API_KEY_CONNECTION_REQUIRED: "API_KEY_CONNECTION_REQUIRED",
  INVALID_OAUTH_START_INPUT: "INVALID_OAUTH_START_INPUT",
  INVALID_OAUTH_COMPLETE_INPUT: "INVALID_OAUTH_COMPLETE_INPUT",
  OAUTH_NOT_SUPPORTED: "OAUTH_NOT_SUPPORTED",
  OAUTH_HANDLER_NOT_CONFIGURED: "OAUTH_HANDLER_NOT_CONFIGURED",
  OAUTH_STATE_INVALID: "OAUTH_STATE_INVALID",
  OAUTH_STATE_EXPIRED: "OAUTH_STATE_EXPIRED",
  OAUTH_STATE_ALREADY_USED: "OAUTH_STATE_ALREADY_USED",
} as const;

export type IntegrationConnectionsBadRequestCode =
  (typeof IntegrationConnectionsBadRequestCodes)[keyof typeof IntegrationConnectionsBadRequestCodes];

export class IntegrationConnectionsBadRequestError extends Error {
  code: IntegrationConnectionsBadRequestCode;

  constructor(code: IntegrationConnectionsBadRequestCode, message: string) {
    super(message);
    this.name = "IntegrationConnectionsBadRequestError";
    this.code = code;
  }
}

export const IntegrationConnectionsNotFoundCodes = {
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  CONNECTION_NOT_FOUND: "CONNECTION_NOT_FOUND",
} as const;

export type IntegrationConnectionsNotFoundCode =
  (typeof IntegrationConnectionsNotFoundCodes)[keyof typeof IntegrationConnectionsNotFoundCodes];

export class IntegrationConnectionsNotFoundError extends Error {
  code: IntegrationConnectionsNotFoundCode;

  constructor(code: IntegrationConnectionsNotFoundCode, message: string) {
    super(message);
    this.name = "IntegrationConnectionsNotFoundError";
    this.code = code;
  }
}

export const IntegrationConnectionsConflictCodes = {
  RESOURCE_SYNC_REQUIRED: "RESOURCE_SYNC_REQUIRED",
  RESOURCE_SYNC_IN_PROGRESS: "RESOURCE_SYNC_IN_PROGRESS",
  RESOURCE_SYNC_FAILED: "RESOURCE_SYNC_FAILED",
} as const;

export type IntegrationConnectionsConflictCode =
  (typeof IntegrationConnectionsConflictCodes)[keyof typeof IntegrationConnectionsConflictCodes];

export class IntegrationConnectionsConflictError extends Error {
  code: IntegrationConnectionsConflictCode;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;

  constructor(input: {
    code: IntegrationConnectionsConflictCode;
    message: string;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
  }) {
    super(input.message);
    this.name = "IntegrationConnectionsConflictError";
    this.code = input.code;
    this.lastErrorCode = input.lastErrorCode ?? null;
    this.lastErrorMessage = input.lastErrorMessage ?? null;
  }
}
