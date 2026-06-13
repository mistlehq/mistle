export const OpenComputerSandboxRuntimeProviderId = "opencomputer";
export const OpenComputerSandboxRuntimeFamilyId = "opencomputer";
export const OpenComputerSandboxRuntimeVariantId = "opencomputer-default";

export const OpenComputerSandboxRuntimeCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const OpenComputerSandboxRuntimeCredentialSlotKeys = {
  API_KEY: `${OpenComputerSandboxRuntimeFamilyId}.${OpenComputerSandboxRuntimeVariantId}.api-key.api-key`,
} as const;
