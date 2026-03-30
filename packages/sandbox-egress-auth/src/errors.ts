import type { EgressGrantClaims } from "./types.js";

export const EgressGrantErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  SUBJECT_REQUIRED: "SUBJECT_REQUIRED",
  JTI_REQUIRED: "JTI_REQUIRED",
  BINDING_ID_REQUIRED: "BINDING_ID_REQUIRED",
  CONNECTION_ID_REQUIRED: "CONNECTION_ID_REQUIRED",
  SECRET_TYPE_REQUIRED: "SECRET_TYPE_REQUIRED",
  UPSTREAM_BASE_URL_REQUIRED: "UPSTREAM_BASE_URL_REQUIRED",
  AUTH_INJECTION_TYPE_REQUIRED: "AUTH_INJECTION_TYPE_REQUIRED",
  AUTH_INJECTION_TARGET_REQUIRED: "AUTH_INJECTION_TARGET_REQUIRED",
  AUTH_INJECTION_USERNAME_INVALID: "AUTH_INJECTION_USERNAME_INVALID",
  ALLOWED_METHODS_INVALID: "ALLOWED_METHODS_INVALID",
  ALLOWED_PATH_PREFIXES_INVALID: "ALLOWED_PATH_PREFIXES_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} satisfies Record<string, string>;

export type EgressGrantErrorCode = (typeof EgressGrantErrorCode)[keyof typeof EgressGrantErrorCode];

type EgressGrantErrorInput = {
  code: EgressGrantErrorCode;
  message: string;
  cause?: unknown;
};

export class EgressGrantError extends Error {
  readonly code: EgressGrantErrorCode;

  constructor(input: EgressGrantErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "EgressGrantError";
    this.code = input.code;
  }
}

export function missingClaimError(
  code: EgressGrantErrorCode,
  claimName: keyof EgressGrantClaims,
): EgressGrantError {
  return new EgressGrantError({
    code,
    message: `Egress grant ${claimName} claim is required.`,
  });
}
