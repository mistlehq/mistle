export const TensorlakeSandboxRuntimeProviderId = "tensorlake";
export const TensorlakeSandboxRuntimeFamilyId = "tensorlake";
export const TensorlakeSandboxRuntimeVariantId = "tensorlake-default";

export const TensorlakeSandboxRuntimeCredentialSecretTypes = {
  API_KEY: "api_key",
} as const;

export const TensorlakeSandboxRuntimeCredentialSlotKeys = {
  API_KEY: `${TensorlakeSandboxRuntimeFamilyId}.${TensorlakeSandboxRuntimeVariantId}.api-key.api-key`,
} as const;
