export const IntegrationConnectionsBadRequestCodes = {
  INVALID_LIST_CONNECTIONS_INPUT: "INVALID_LIST_CONNECTIONS_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
  INVALID_CREATE_CONNECTION_INPUT: "INVALID_CREATE_CONNECTION_INPUT",
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
