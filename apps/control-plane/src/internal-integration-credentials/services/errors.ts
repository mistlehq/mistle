export const InternalIntegrationCredentialsErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_RESOLVE_INPUT: "INVALID_RESOLVE_INPUT",
  INVALID_TARGET_SECRETS: "INVALID_TARGET_SECRETS",
  CONNECTION_NOT_FOUND: "CONNECTION_NOT_FOUND",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  AMBIGUOUS_CREDENTIAL_MATCH: "AMBIGUOUS_CREDENTIAL_MATCH",
  RESOLVER_NOT_FOUND: "RESOLVER_NOT_FOUND",
} as const;

export type InternalIntegrationCredentialsErrorCode =
  (typeof InternalIntegrationCredentialsErrorCodes)[keyof typeof InternalIntegrationCredentialsErrorCodes];

type InternalIntegrationCredentialsErrorStatusCode = 400 | 401 | 404;

export class InternalIntegrationCredentialsError extends Error {
  readonly code: InternalIntegrationCredentialsErrorCode;
  readonly statusCode: InternalIntegrationCredentialsErrorStatusCode;

  constructor(
    code: InternalIntegrationCredentialsErrorCode,
    statusCode: InternalIntegrationCredentialsErrorStatusCode,
    message: string,
  ) {
    super(message);
    this.name = "InternalIntegrationCredentialsError";
    this.code = code;
    this.statusCode = statusCode;
  }
}
