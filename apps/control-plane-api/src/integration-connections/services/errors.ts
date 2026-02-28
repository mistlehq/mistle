export const IntegrationConnectionsBadRequestCodes = {
  INVALID_LIST_CONNECTIONS_INPUT: "INVALID_LIST_CONNECTIONS_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
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
