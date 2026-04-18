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
  | "AGENT_RUNTIME_NOT_FOUND"
  | "INVALID_AGENT_RUNTIME_CONFIG"
  | "MISSING_AGENT_PROVIDER_ACCESS"
  | "AGENT_RUNTIME_MCP_TARGET_CLIENT_MISSING"
  | "ROUTE_CONFLICT"
  | "ARTIFACT_CONFLICT"
  | "MCP_CONFLICT"
  | "MCP_INVALID_REF"
  | "RUNTIME_CLIENT_SETUP_CONFLICT"
  | "RUNTIME_CLIENT_SETUP_INVALID_REF"
  | "AGENT_RUNTIME_CONFLICT";

export const CompilerErrorCodes: {
  CONNECTION_MISMATCH: CompilerErrorCode;
  TARGET_DISABLED: CompilerErrorCode;
  CONNECTION_NOT_ACTIVE: CompilerErrorCode;
  KIND_MISMATCH: CompilerErrorCode;
  INVALID_TARGET_CONFIG: CompilerErrorCode;
  INVALID_TARGET_SECRETS: CompilerErrorCode;
  INVALID_BINDING_CONFIG: CompilerErrorCode;
  AGENT_RUNTIME_NOT_FOUND: CompilerErrorCode;
  INVALID_AGENT_RUNTIME_CONFIG: CompilerErrorCode;
  MISSING_AGENT_PROVIDER_ACCESS: CompilerErrorCode;
  AGENT_RUNTIME_MCP_TARGET_CLIENT_MISSING: CompilerErrorCode;
  ROUTE_CONFLICT: CompilerErrorCode;
  ARTIFACT_CONFLICT: CompilerErrorCode;
  MCP_CONFLICT: CompilerErrorCode;
  MCP_INVALID_REF: CompilerErrorCode;
  RUNTIME_CLIENT_SETUP_CONFLICT: CompilerErrorCode;
  RUNTIME_CLIENT_SETUP_INVALID_REF: CompilerErrorCode;
  AGENT_RUNTIME_CONFLICT: CompilerErrorCode;
} = {
  CONNECTION_MISMATCH: "CONNECTION_MISMATCH",
  TARGET_DISABLED: "TARGET_DISABLED",
  CONNECTION_NOT_ACTIVE: "CONNECTION_NOT_ACTIVE",
  KIND_MISMATCH: "KIND_MISMATCH",
  INVALID_TARGET_CONFIG: "INVALID_TARGET_CONFIG",
  INVALID_TARGET_SECRETS: "INVALID_TARGET_SECRETS",
  INVALID_BINDING_CONFIG: "INVALID_BINDING_CONFIG",
  AGENT_RUNTIME_NOT_FOUND: "AGENT_RUNTIME_NOT_FOUND",
  INVALID_AGENT_RUNTIME_CONFIG: "INVALID_AGENT_RUNTIME_CONFIG",
  MISSING_AGENT_PROVIDER_ACCESS: "MISSING_AGENT_PROVIDER_ACCESS",
  AGENT_RUNTIME_MCP_TARGET_CLIENT_MISSING: "AGENT_RUNTIME_MCP_TARGET_CLIENT_MISSING",
  ROUTE_CONFLICT: "ROUTE_CONFLICT",
  ARTIFACT_CONFLICT: "ARTIFACT_CONFLICT",
  MCP_CONFLICT: "MCP_CONFLICT",
  MCP_INVALID_REF: "MCP_INVALID_REF",
  RUNTIME_CLIENT_SETUP_CONFLICT: "RUNTIME_CLIENT_SETUP_CONFLICT",
  RUNTIME_CLIENT_SETUP_INVALID_REF: "RUNTIME_CLIENT_SETUP_INVALID_REF",
  AGENT_RUNTIME_CONFLICT: "AGENT_RUNTIME_CONFLICT",
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

export type IdentityLinkingErrorCode =
  | "IDENTITY_LINKING_NOT_SUPPORTED"
  | "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG"
  | "IDENTITY_LINKING_AUTHORIZATION_FAILED";

export const IdentityLinkingErrorCodes: {
  IDENTITY_LINKING_NOT_SUPPORTED: IdentityLinkingErrorCode;
  IDENTITY_LINKING_INVALID_PROVIDER_CONFIG: IdentityLinkingErrorCode;
  IDENTITY_LINKING_AUTHORIZATION_FAILED: IdentityLinkingErrorCode;
} = {
  IDENTITY_LINKING_NOT_SUPPORTED: "IDENTITY_LINKING_NOT_SUPPORTED",
  IDENTITY_LINKING_INVALID_PROVIDER_CONFIG: "IDENTITY_LINKING_INVALID_PROVIDER_CONFIG",
  IDENTITY_LINKING_AUTHORIZATION_FAILED: "IDENTITY_LINKING_AUTHORIZATION_FAILED",
};

export class IntegrationIdentityLinkingError extends IntegrationsCoreError {
  constructor(code: IdentityLinkingErrorCode, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "IntegrationIdentityLinkingError";
  }
}
