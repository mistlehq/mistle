export const SandboxRuntimePlanCompilerErrorCodes = {
  PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
  PROFILE_VERSION_NOT_FOUND: "PROFILE_VERSION_NOT_FOUND",
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

export type SandboxRuntimePlanCompilerErrorCode =
  (typeof SandboxRuntimePlanCompilerErrorCodes)[keyof typeof SandboxRuntimePlanCompilerErrorCodes];

export class SandboxRuntimePlanCompilerError extends Error {
  readonly code: SandboxRuntimePlanCompilerErrorCode;

  constructor(input: {
    code: SandboxRuntimePlanCompilerErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, {
      cause: input.cause,
    });
    this.name = "SandboxRuntimePlanCompilerError";
    this.code = input.code;
  }
}
