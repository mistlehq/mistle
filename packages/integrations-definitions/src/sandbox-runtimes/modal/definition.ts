import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  ModalSandboxRuntimeCredentialSecretTypes,
  ModalSandboxRuntimeCredentialSlotKeys,
  ModalSandboxRuntimeFamilyId,
  ModalSandboxRuntimeProviderId,
  ModalSandboxRuntimeVariantId,
} from "./constants.js";
import { ModalSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";
import {
  ModalSandboxRuntimeBindingConfigSchema,
  ModalSandboxRuntimeConnectionConfigSchema,
  type ModalSandboxRuntimeConnectionConfig,
  ModalSandboxRuntimeTargetConfigSchema,
  ModalSandboxRuntimeTargetSecretSchema,
} from "./schemas.js";

type ModalSandboxRuntimeIntegrationDefinition = IntegrationDefinition<
  typeof ModalSandboxRuntimeTargetConfigSchema,
  typeof ModalSandboxRuntimeTargetSecretSchema,
  typeof ModalSandboxRuntimeBindingConfigSchema,
  ModalSandboxRuntimeConnectionConfig
>;

const EmptyCompileBindingResult: CompileBindingResult = {
  egressRoutes: [],
  artifacts: [],
  runtimeClients: [],
};

export const ModalSandboxRuntimeDefinition: ModalSandboxRuntimeIntegrationDefinition = {
  familyId: ModalSandboxRuntimeFamilyId,
  variantId: ModalSandboxRuntimeVariantId,
  kind: IntegrationKinds.SANDBOX,
  displayName: "Modal",
  description: "Run sandboxes on Modal VM Sandboxes with your organization's token.",
  logoKey: "modal",
  sandboxRuntime: {
    providerId: ModalSandboxRuntimeProviderId,
    displayName: "Modal",
    resourceCapabilities: ModalSandboxRuntimeResourceCapabilities,
  },
  targetConfigSchema: ModalSandboxRuntimeTargetConfigSchema,
  targetSecretSchema: ModalSandboxRuntimeTargetSecretSchema,
  bindingConfigSchema: ModalSandboxRuntimeBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "Token",
      kind: "form",
      secretFields: [
        {
          name: "tokenId",
          label: "Token ID",
          placeholder: "Enter Modal token ID",
          inputType: "password",
          secretType: ModalSandboxRuntimeCredentialSecretTypes.TOKEN_ID,
          slotKey: ModalSandboxRuntimeCredentialSlotKeys.TOKEN_ID,
        },
        {
          name: "tokenSecret",
          label: "Token secret",
          placeholder: "Enter Modal token secret",
          inputType: "password",
          secretType: ModalSandboxRuntimeCredentialSecretTypes.TOKEN_SECRET,
          slotKey: ModalSandboxRuntimeCredentialSlotKeys.TOKEN_SECRET,
        },
      ],
      configSchema: ModalSandboxRuntimeConnectionConfigSchema,
    },
  ],
  compileBinding: () => EmptyCompileBindingResult,
};
