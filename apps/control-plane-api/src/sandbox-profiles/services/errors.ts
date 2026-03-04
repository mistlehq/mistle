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

export const SandboxProfilesIntegrationBindingsBadRequestCodes = {
  INVALID_BINDING_REFERENCE: "INVALID_BINDING_REFERENCE",
  INVALID_BINDING_CONNECTION_REFERENCE: "INVALID_BINDING_CONNECTION_REFERENCE",
  INVALID_BINDING_CONFIG_REFERENCE: "INVALID_BINDING_CONFIG_REFERENCE",
} as const;

export type SandboxProfilesIntegrationBindingsBadRequestCode =
  (typeof SandboxProfilesIntegrationBindingsBadRequestCodes)[keyof typeof SandboxProfilesIntegrationBindingsBadRequestCodes];

export class SandboxProfilesIntegrationBindingsBadRequestError extends Error {
  code: SandboxProfilesIntegrationBindingsBadRequestCode;
  details?: {
    issues: ReadonlyArray<{
      clientRef?: string;
      bindingIdOrDraftIndex: string;
      validatorCode: string;
      field: string;
      safeMessage: string;
    }>;
  };

  constructor(
    code: SandboxProfilesIntegrationBindingsBadRequestCode,
    message: string,
    details?: {
      issues: ReadonlyArray<{
        clientRef?: string;
        bindingIdOrDraftIndex: string;
        validatorCode: string;
        field: string;
        safeMessage: string;
      }>;
    },
  ) {
    super(message);
    this.name = "SandboxProfilesIntegrationBindingsBadRequestError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export const SandboxProfilesCompileErrorCodes = {
  INVALID_BINDING_CONNECTION_REFERENCE: "INVALID_BINDING_CONNECTION_REFERENCE",
  INVALID_CONNECTION_TARGET_REFERENCE: "INVALID_CONNECTION_TARGET_REFERENCE",
  CONNECTION_MISMATCH: "CONNECTION_MISMATCH",
  TARGET_DISABLED: "TARGET_DISABLED",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  KIND_MISMATCH: "KIND_MISMATCH",
  INVALID_TARGET_CONFIG: "INVALID_TARGET_CONFIG",
  INVALID_TARGET_SECRETS: "INVALID_TARGET_SECRETS",
  INVALID_BINDING_CONFIG: "INVALID_BINDING_CONFIG",
  ROUTE_CONFLICT: "ROUTE_CONFLICT",
  ARTIFACT_CONFLICT: "ARTIFACT_CONFLICT",
  RUNTIME_CLIENT_SETUP_CONFLICT: "RUNTIME_CLIENT_SETUP_CONFLICT",
  RUNTIME_CLIENT_SETUP_INVALID_REF: "RUNTIME_CLIENT_SETUP_INVALID_REF",
} as const;

export type SandboxProfilesCompileErrorCode =
  (typeof SandboxProfilesCompileErrorCodes)[keyof typeof SandboxProfilesCompileErrorCodes];

export class SandboxProfilesCompileError extends Error {
  code: SandboxProfilesCompileErrorCode;

  constructor(code: SandboxProfilesCompileErrorCode, message: string) {
    super(message);
    this.name = "SandboxProfilesCompileError";
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
