import { HttpError } from "@mistle/http/errors.js";

export const InternalIntegrationCredentialsErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_RESOLVE_INPUT: "INVALID_RESOLVE_INPUT",
  INVALID_TARGET_SECRETS: "INVALID_TARGET_SECRETS",
  CONNECTION_NOT_FOUND: "CONNECTION_NOT_FOUND",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  BINDING_NOT_FOUND: "BINDING_NOT_FOUND",
  BINDING_CONNECTION_MISMATCH: "BINDING_CONNECTION_MISMATCH",
  BINDING_REQUIRED: "BINDING_REQUIRED",
  INVALID_BINDING_CONFIG: "INVALID_BINDING_CONFIG",
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  AMBIGUOUS_CREDENTIAL_MATCH: "AMBIGUOUS_CREDENTIAL_MATCH",
  OAUTH2_REFRESH_FAILED: "OAUTH2_REFRESH_FAILED",
  RESOLVER_NOT_FOUND: "RESOLVER_NOT_FOUND",
} as const;

export type InternalIntegrationCredentialsErrorCode =
  (typeof InternalIntegrationCredentialsErrorCodes)[keyof typeof InternalIntegrationCredentialsErrorCodes];

type InternalIntegrationCredentialsErrorStatusCode = 400 | 404;

export class InternalIntegrationCredentialsError extends HttpError {
  readonly code: InternalIntegrationCredentialsErrorCode;
  readonly status: InternalIntegrationCredentialsErrorStatusCode;

  constructor(
    code: InternalIntegrationCredentialsErrorCode,
    status: InternalIntegrationCredentialsErrorStatusCode,
    message: string,
  ) {
    super(code, message);
    this.code = code;
    this.status = status;
  }
}
