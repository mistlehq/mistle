export const FreestyleSandboxRuntimeProviderId = "freestyle";
export const FreestyleSandboxRuntimeFamilyId = "freestyle";
export const FreestyleSandboxRuntimeVariantId = "freestyle-default";

export const FreestyleSandboxRuntimeCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const FreestyleSandboxRuntimeCredentialSlotKeys = {
  API_KEY: `${FreestyleSandboxRuntimeFamilyId}.${FreestyleSandboxRuntimeVariantId}.api-key.api-key`,
} as const;
