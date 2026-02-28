export class IntegrationsCoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IntegrationsCoreError";
    this.code = code;
  }
}

export type DefinitionRegistryErrorCode =
  | "INVALID_DEFINITION"
  | "DUPLICATE_DEFINITION"
  | "DEFINITION_NOT_FOUND";

export const DefinitionRegistryErrorCodes: {
  INVALID_DEFINITION: DefinitionRegistryErrorCode;
  DUPLICATE_DEFINITION: DefinitionRegistryErrorCode;
  DEFINITION_NOT_FOUND: DefinitionRegistryErrorCode;
} = {
  INVALID_DEFINITION: "INVALID_DEFINITION",
  DUPLICATE_DEFINITION: "DUPLICATE_DEFINITION",
  DEFINITION_NOT_FOUND: "DEFINITION_NOT_FOUND",
};

export class IntegrationDefinitionRegistryError extends IntegrationsCoreError {
  constructor(code: DefinitionRegistryErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationDefinitionRegistryError";
  }
}

export type ManifestErrorCode = "INVALID_MANIFEST" | "INVALID_TRIGGER_RULES";

export const ManifestErrorCodes: {
  INVALID_MANIFEST: ManifestErrorCode;
  INVALID_TRIGGER_RULES: ManifestErrorCode;
} = {
  INVALID_MANIFEST: "INVALID_MANIFEST",
  INVALID_TRIGGER_RULES: "INVALID_TRIGGER_RULES",
};

export class IntegrationManifestError extends IntegrationsCoreError {
  constructor(code: ManifestErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationManifestError";
  }
}

export type CompilerErrorCode =
  | "CONNECTION_MISMATCH"
  | "TARGET_DISABLED"
  | "CONNECTION_NOT_ACTIVE"
  | "KIND_MISMATCH"
  | "INVALID_TARGET_CONFIG"
  | "INVALID_BINDING_CONFIG"
  | "ROUTE_CONFLICT"
  | "ARTIFACT_CONFLICT"
  | "RUNTIME_CLIENT_SETUP_CONFLICT";

export const CompilerErrorCodes: {
  CONNECTION_MISMATCH: CompilerErrorCode;
  TARGET_DISABLED: CompilerErrorCode;
  CONNECTION_NOT_ACTIVE: CompilerErrorCode;
  KIND_MISMATCH: CompilerErrorCode;
  INVALID_TARGET_CONFIG: CompilerErrorCode;
  INVALID_BINDING_CONFIG: CompilerErrorCode;
  ROUTE_CONFLICT: CompilerErrorCode;
  ARTIFACT_CONFLICT: CompilerErrorCode;
  RUNTIME_CLIENT_SETUP_CONFLICT: CompilerErrorCode;
} = {
  CONNECTION_MISMATCH: "CONNECTION_MISMATCH",
  TARGET_DISABLED: "TARGET_DISABLED",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  KIND_MISMATCH: "KIND_MISMATCH",
  INVALID_TARGET_CONFIG: "INVALID_TARGET_CONFIG",
  INVALID_BINDING_CONFIG: "INVALID_BINDING_CONFIG",
  ROUTE_CONFLICT: "ROUTE_CONFLICT",
  ARTIFACT_CONFLICT: "ARTIFACT_CONFLICT",
  RUNTIME_CLIENT_SETUP_CONFLICT: "RUNTIME_CLIENT_SETUP_CONFLICT",
};

export class IntegrationCompilerError extends IntegrationsCoreError {
  constructor(code: CompilerErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationCompilerError";
  }
}
