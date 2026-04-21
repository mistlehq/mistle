import { HttpError } from "@mistle/http/errors.js";

export const InternalIdentityLinkingErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_RESOLVE_INPUT: "INVALID_RESOLVE_INPUT",
  INVALID_SIGN_COMMIT_PAYLOAD_INPUT: "INVALID_SIGN_COMMIT_PAYLOAD_INPUT",
  PROVIDER_CONFIG_NOT_FOUND: "PROVIDER_CONFIG_NOT_FOUND",
  INVALID_PROVIDER_CONFIG_INPUT: "INVALID_PROVIDER_CONFIG_INPUT",
  PRINCIPAL_NOT_FOUND: "PRINCIPAL_NOT_FOUND",
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  AMBIGUOUS_CREDENTIAL_KIND: "AMBIGUOUS_CREDENTIAL_KIND",
  ACTING_USER_REQUIRED: "ACTING_USER_REQUIRED",
  UNSUPPORTED_SIGNING_FORMAT: "UNSUPPORTED_SIGNING_FORMAT",
  CREDENTIAL_REAUTHORIZATION_REQUIRED: "CREDENTIAL_REAUTHORIZATION_REQUIRED",
  CREDENTIAL_REFRESH_FAILED: "CREDENTIAL_REFRESH_FAILED",
} as const;

export type InternalIdentityLinkingErrorCode =
  (typeof InternalIdentityLinkingErrorCodes)[keyof typeof InternalIdentityLinkingErrorCodes];

type InternalIdentityLinkingErrorStatusCode = 400 | 404;

export class InternalIdentityLinkingError extends HttpError {
  readonly code: InternalIdentityLinkingErrorCode;
  readonly status: InternalIdentityLinkingErrorStatusCode;

  constructor(
    code: InternalIdentityLinkingErrorCode,
    status: InternalIdentityLinkingErrorStatusCode,
    message: string,
  ) {
    super(code, message);
    this.code = code;
    this.status = status;
  }
}
