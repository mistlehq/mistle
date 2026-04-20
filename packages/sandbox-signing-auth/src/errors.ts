export const SigningGrantErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  SUBJECT_REQUIRED: "SUBJECT_REQUIRED",
  JTI_REQUIRED: "JTI_REQUIRED",
  ORGANIZATION_ID_REQUIRED: "ORGANIZATION_ID_REQUIRED",
  ACTING_USER_ID_REQUIRED: "ACTING_USER_ID_REQUIRED",
  PROVIDER_FAMILY_REQUIRED: "PROVIDER_FAMILY_REQUIRED",
  FORMAT_REQUIRED: "FORMAT_REQUIRED",
  KEY_REF_REQUIRED: "KEY_REF_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} as const;

export type SigningGrantErrorCode =
  (typeof SigningGrantErrorCode)[keyof typeof SigningGrantErrorCode];

type SigningGrantErrorInput = {
  code: SigningGrantErrorCode;
  message: string;
  cause?: unknown;
};

export class SigningGrantError extends Error {
  readonly code: SigningGrantErrorCode;

  constructor(input: SigningGrantErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "SigningGrantError";
    this.code = input.code;
  }
}
