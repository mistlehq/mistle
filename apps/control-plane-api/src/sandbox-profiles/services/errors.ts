export const SandboxProfilesAuthErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  ACTIVE_ORGANIZATION_REQUIRED: "ACTIVE_ORGANIZATION_REQUIRED",
} as const;

export type SandboxProfilesAuthErrorCode =
  (typeof SandboxProfilesAuthErrorCodes)[keyof typeof SandboxProfilesAuthErrorCodes];

export class SandboxProfilesUnauthorizedError extends Error {
  code: SandboxProfilesAuthErrorCode;

  constructor(message: string) {
    super(message);
    this.name = "SandboxProfilesUnauthorizedError";
    this.code = SandboxProfilesAuthErrorCodes.UNAUTHORIZED;
  }
}

export class SandboxProfilesForbiddenError extends Error {
  code: SandboxProfilesAuthErrorCode;

  constructor(message: string) {
    super(message);
    this.name = "SandboxProfilesForbiddenError";
    this.code = SandboxProfilesAuthErrorCodes.ACTIVE_ORGANIZATION_REQUIRED;
  }
}

export const SandboxProfilesBadRequestCodes = {
  INVALID_LIST_PROFILES_INPUT: "INVALID_LIST_PROFILES_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
} as const;

export type SandboxProfilesBadRequestCode =
  (typeof SandboxProfilesBadRequestCodes)[keyof typeof SandboxProfilesBadRequestCodes];

export class SandboxProfilesBadRequestError extends Error {
  code: SandboxProfilesBadRequestCode;

  constructor(code: SandboxProfilesBadRequestCode, message: string) {
    super(message);
    this.name = "SandboxProfilesBadRequestError";
    this.code = code;
  }
}

export const SandboxProfilesNotFoundCodes = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  PROFILE_VERSION_NOT_FOUND: "PROFILE_VERSION_NOT_FOUND",
} as const;

export type SandboxProfilesNotFoundCode =
  (typeof SandboxProfilesNotFoundCodes)[keyof typeof SandboxProfilesNotFoundCodes];

export class SandboxProfilesNotFoundError extends Error {
  code: SandboxProfilesNotFoundCode;

  constructor(code: SandboxProfilesNotFoundCode, message: string) {
    super(message);
    this.name = "SandboxProfilesNotFoundError";
    this.code = code;
  }
}
