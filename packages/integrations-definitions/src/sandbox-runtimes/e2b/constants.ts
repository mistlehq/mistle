export const E2BSandboxRuntimeProviderId = "e2b";
export const E2BSandboxRuntimeFamilyId = "e2b";
export const E2BSandboxRuntimeVariantId = "e2b-default";

export const E2BSandboxRuntimeCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const E2BSandboxRuntimeCredentialSlotKeys = {
  API_KEY: `${E2BSandboxRuntimeFamilyId}.${E2BSandboxRuntimeVariantId}.api-key.api-key`,
} as const;
