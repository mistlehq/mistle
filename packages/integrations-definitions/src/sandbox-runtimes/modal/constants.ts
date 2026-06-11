export const ModalSandboxRuntimeProviderId = "modal";
export const ModalSandboxRuntimeFamilyId = "modal";
export const ModalSandboxRuntimeVariantId = "modal-default";
export const ModalSandboxRuntimeDefaultAppName = "mistle-modal-sandboxes";

export const ModalSandboxRuntimeCredentialSecretTypes = {
  TOKEN_ID: "api_key",
  TOKEN_SECRET: "api_key",
} as const;

export const ModalSandboxRuntimeCredentialSlotKeys = {
  TOKEN_ID: `${ModalSandboxRuntimeFamilyId}.${ModalSandboxRuntimeVariantId}.api-key.token-id`,
  TOKEN_SECRET: `${ModalSandboxRuntimeFamilyId}.${ModalSandboxRuntimeVariantId}.api-key.token-secret`,
} as const;
