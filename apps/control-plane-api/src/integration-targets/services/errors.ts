export const IntegrationTargetsBadRequestCodes = {
  INVALID_LIST_TARGETS_INPUT: "INVALID_LIST_TARGETS_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
} as const;

export type IntegrationTargetsBadRequestCode =
  (typeof IntegrationTargetsBadRequestCodes)[keyof typeof IntegrationTargetsBadRequestCodes];

export class IntegrationTargetsBadRequestError extends Error {
  code: IntegrationTargetsBadRequestCode;

  constructor(code: IntegrationTargetsBadRequestCode, message: string) {
    super(message);
    this.name = "IntegrationTargetsBadRequestError";
    this.code = code;
  }
}
