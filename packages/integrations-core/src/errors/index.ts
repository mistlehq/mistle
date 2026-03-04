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

export type TriggerRulesErrorCode = "INVALID_TRIGGER_RULES";

export const TriggerRulesErrorCodes: {
  INVALID_TRIGGER_RULES: TriggerRulesErrorCode;
} = {
  INVALID_TRIGGER_RULES: "INVALID_TRIGGER_RULES",
};

export class IntegrationTriggerRulesError extends IntegrationsCoreError {
  constructor(code: TriggerRulesErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationTriggerRulesError";
  }
}

export type CompilerErrorCode =
  | "CONNECTION_MISMATCH"
  | "TARGET_DISABLED"
  | "CONNECTION_NOT_ACTIVE"
  | "KIND_MISMATCH"
  | "INVALID_TARGET_CONFIG"
  | "INVALID_TARGET_SECRETS"
  | "INVALID_BINDING_CONFIG"
  | "ROUTE_CONFLICT"
  | "ARTIFACT_CONFLICT"
  | "RUNTIME_CLIENT_SETUP_CONFLICT"
  | "RUNTIME_CLIENT_SETUP_INVALID_REF";

export const CompilerErrorCodes: {
  CONNECTION_MISMATCH: CompilerErrorCode;
  TARGET_DISABLED: CompilerErrorCode;
  CONNECTION_NOT_ACTIVE: CompilerErrorCode;
  KIND_MISMATCH: CompilerErrorCode;
  INVALID_TARGET_CONFIG: CompilerErrorCode;
  INVALID_TARGET_SECRETS: CompilerErrorCode;
  INVALID_BINDING_CONFIG: CompilerErrorCode;
  ROUTE_CONFLICT: CompilerErrorCode;
  ARTIFACT_CONFLICT: CompilerErrorCode;
  RUNTIME_CLIENT_SETUP_CONFLICT: CompilerErrorCode;
  RUNTIME_CLIENT_SETUP_INVALID_REF: CompilerErrorCode;
} = {
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
};

export class IntegrationCompilerError extends IntegrationsCoreError {
  constructor(code: CompilerErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationCompilerError";
  }
}

export type WebhookErrorCode =
  | "WEBHOOK_HANDLER_NOT_CONFIGURED"
  | "WEBHOOK_VERIFY_FAILED"
  | "WEBHOOK_CONNECTION_NOT_FOUND"
  | "WEBHOOK_CONNECTION_AMBIGUOUS"
  | "WEBHOOK_CONNECTION_RESOLUTION_FAILED";

export const WebhookErrorCodes: {
  WEBHOOK_HANDLER_NOT_CONFIGURED: WebhookErrorCode;
  WEBHOOK_VERIFY_FAILED: WebhookErrorCode;
  WEBHOOK_CONNECTION_NOT_FOUND: WebhookErrorCode;
  WEBHOOK_CONNECTION_AMBIGUOUS: WebhookErrorCode;
  WEBHOOK_CONNECTION_RESOLUTION_FAILED: WebhookErrorCode;
} = {
  WEBHOOK_HANDLER_NOT_CONFIGURED: "WEBHOOK_HANDLER_NOT_CONFIGURED",
  WEBHOOK_VERIFY_FAILED: "WEBHOOK_VERIFY_FAILED",
  WEBHOOK_CONNECTION_NOT_FOUND: "WEBHOOK_CONNECTION_NOT_FOUND",
  WEBHOOK_CONNECTION_AMBIGUOUS: "WEBHOOK_CONNECTION_AMBIGUOUS",
  WEBHOOK_CONNECTION_RESOLUTION_FAILED: "WEBHOOK_CONNECTION_RESOLUTION_FAILED",
};

export class IntegrationWebhookError extends IntegrationsCoreError {
  constructor(code: WebhookErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationWebhookError";
  }
}
