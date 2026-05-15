import { BadRequestError, ConflictError, NotFoundError } from "@mistle/http/errors.js";

export const SandboxProfilesBadRequestCodes = {
  INVALID_LIST_PROFILES_INPUT: "INVALID_LIST_PROFILES_INPUT",
  INVALID_PAGINATION_CURSOR: "INVALID_PAGINATION_CURSOR",
  INVALID_PRIMARY_REPOSITORY: "INVALID_PRIMARY_REPOSITORY",
  INVALID_REFRESH_SCHEDULE: "INVALID_REFRESH_SCHEDULE",
  GIT_SIGNING_CONFIGURATION_REQUIRED: "GIT_SIGNING_CONFIGURATION_REQUIRED",
  UNSUPPORTED_GIT_SIGNING_FORMAT: "UNSUPPORTED_GIT_SIGNING_FORMAT",
  INVALID_SANDBOX_RUNTIME_CONFIG: "INVALID_SANDBOX_RUNTIME_CONFIG",
} as const;

export type SandboxProfilesBadRequestCode =
  (typeof SandboxProfilesBadRequestCodes)[keyof typeof SandboxProfilesBadRequestCodes];

export class SandboxProfilesBadRequestError extends BadRequestError {
  code: SandboxProfilesBadRequestCode;

  constructor(code: SandboxProfilesBadRequestCode, message: string) {
    super(code, message);
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

export class SandboxProfilesIntegrationBindingsBadRequestError extends BadRequestError {
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
    super(code, message);
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export const SandboxProfilesCompileErrorCodes = {
  AGENT_RUNTIME_REQUIRED: "AGENT_RUNTIME_REQUIRED",
  SANDBOX_PROVIDER_REQUIRED: "SANDBOX_PROVIDER_REQUIRED",
  INVALID_SANDBOX_PROVIDER: "INVALID_SANDBOX_PROVIDER",
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

export class SandboxProfilesCompileError extends BadRequestError {
  code: SandboxProfilesCompileErrorCode;

  constructor(code: SandboxProfilesCompileErrorCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export const SandboxProfilesConflictCodes = {
  DRAFT_ALREADY_EXISTS: "DRAFT_ALREADY_EXISTS",
  DRAFT_ONLY_PROFILE_VERSION_CANNOT_BE_DISCARDED: "DRAFT_ONLY_PROFILE_VERSION_CANNOT_BE_DISCARDED",
  PROFILE_VERSION_ACTIVE: "PROFILE_VERSION_ACTIVE",
  PROFILE_VERSION_NOT_DRAFT: "PROFILE_VERSION_NOT_DRAFT",
  PROFILE_VERSION_NOT_PUBLISHABLE: "PROFILE_VERSION_NOT_PUBLISHABLE",
  PROFILE_VERSION_SNAPSHOT_IN_PROGRESS: "PROFILE_VERSION_SNAPSHOT_IN_PROGRESS",
  PROFILE_VERSION_NOT_USABLE: "PROFILE_VERSION_NOT_USABLE",
} as const;

export type SandboxProfilesConflictCode =
  (typeof SandboxProfilesConflictCodes)[keyof typeof SandboxProfilesConflictCodes];

export class SandboxProfilesConflictError extends ConflictError {
  code: SandboxProfilesConflictCode;

  constructor(code: SandboxProfilesConflictCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export const SandboxProfilesNotFoundCodes = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  PROFILE_VERSION_NOT_FOUND: "PROFILE_VERSION_NOT_FOUND",
} as const;

export type SandboxProfilesNotFoundCode =
  (typeof SandboxProfilesNotFoundCodes)[keyof typeof SandboxProfilesNotFoundCodes];

export class SandboxProfilesNotFoundError extends NotFoundError {
  code: SandboxProfilesNotFoundCode;

  constructor(code: SandboxProfilesNotFoundCode, message: string) {
    super(code, message);
    this.code = code;
  }
}

export const SandboxProfilePublishabilityIssueCodes = {
  PROFILE_VERSION_NOT_DRAFT: "PROFILE_VERSION_NOT_DRAFT",
  AGENT_BINDING_REQUIRED: "AGENT_BINDING_REQUIRED",
  INVALID_BINDING_CONNECTION_REFERENCE: "INVALID_BINDING_CONNECTION_REFERENCE",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  TARGET_DISABLED: "TARGET_DISABLED",
  SANDBOX_PROVIDER_REQUIRED: "SANDBOX_PROVIDER_REQUIRED",
  INVALID_SANDBOX_PROVIDER: "INVALID_SANDBOX_PROVIDER",
  SANDBOX_MANAGED_PROVIDER_UNAVAILABLE: "SANDBOX_MANAGED_PROVIDER_UNAVAILABLE",
  INVALID_SANDBOX_CONNECTION_REFERENCE: "INVALID_SANDBOX_CONNECTION_REFERENCE",
  SANDBOX_CONNECTION_NOT_ACTIVE: "SANDBOX_CONNECTION_NOT_ACTIVE",
  SANDBOX_CONNECTION_KIND_MISMATCH: "SANDBOX_CONNECTION_KIND_MISMATCH",
  SANDBOX_CONNECTION_PROVIDER_MISMATCH: "SANDBOX_CONNECTION_PROVIDER_MISMATCH",
  INVALID_SANDBOX_RESOURCES: "INVALID_SANDBOX_RESOURCES",
} as const;

export type SandboxProfilePublishabilityIssueCode =
  (typeof SandboxProfilePublishabilityIssueCodes)[keyof typeof SandboxProfilePublishabilityIssueCodes];

export const SandboxProfileAutomationImpactIssueCodes = {
  AGENT_BINDING_REQUIRED: "AGENT_BINDING_REQUIRED",
  AGENT_BINDING_PRIMARY_REQUIRED: "AGENT_BINDING_PRIMARY_REQUIRED",
  AGENT_BINDING_AMBIGUOUS: "AGENT_BINDING_AMBIGUOUS",
  AGENT_BINDING_RUNTIME_INCOMPATIBLE: "AGENT_BINDING_RUNTIME_INCOMPATIBLE",
  INVALID_BINDING_CONNECTION_REFERENCE: "INVALID_BINDING_CONNECTION_REFERENCE",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  TARGET_DISABLED: "TARGET_DISABLED",
  TARGET_MISSING: "TARGET_MISSING",
  WEBHOOK_SOURCE_CONNECTION_NOT_BOUND: "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
  PRIMARY_REPOSITORY_UNAVAILABLE: "PRIMARY_REPOSITORY_UNAVAILABLE",
} as const;

export type SandboxProfileAutomationImpactIssueCode =
  (typeof SandboxProfileAutomationImpactIssueCodes)[keyof typeof SandboxProfileAutomationImpactIssueCodes];
