import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  TensorlakeSandboxRuntimeCredentialSecretTypes,
  TensorlakeSandboxRuntimeCredentialSlotKeys,
  TensorlakeSandboxRuntimeFamilyId,
  TensorlakeSandboxRuntimeProviderId,
  TensorlakeSandboxRuntimeVariantId,
} from "./constants.js";
import { TensorlakeSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";
import {
  TensorlakeSandboxRuntimeBindingConfigSchema,
  TensorlakeSandboxRuntimeConnectionConfigSchema,
  type TensorlakeSandboxRuntimeConnectionConfig,
  TensorlakeSandboxRuntimeTargetConfigSchema,
  TensorlakeSandboxRuntimeTargetSecretSchema,
} from "./schemas.js";

type TensorlakeSandboxRuntimeIntegrationDefinition = IntegrationDefinition<
  typeof TensorlakeSandboxRuntimeTargetConfigSchema,
  typeof TensorlakeSandboxRuntimeTargetSecretSchema,
  typeof TensorlakeSandboxRuntimeBindingConfigSchema,
  TensorlakeSandboxRuntimeConnectionConfig
>;

const EmptyCompileBindingResult: CompileBindingResult = {
  egressRoutes: [],
  artifacts: [],
  runtimeClients: [],
};

export const TensorlakeSandboxRuntimeDefinition: TensorlakeSandboxRuntimeIntegrationDefinition = {
  familyId: TensorlakeSandboxRuntimeFamilyId,
  variantId: TensorlakeSandboxRuntimeVariantId,
  kind: IntegrationKinds.SANDBOX,
  displayName: "Tensorlake",
  description: "Run sandboxes on Tensorlake with your organization's API keys.",
  logoKey: "tensorlake",
  sandboxRuntime: {
    providerId: TensorlakeSandboxRuntimeProviderId,
    displayName: "Tensorlake",
    resourceCapabilities: TensorlakeSandboxRuntimeResourceCapabilities,
  },
  targetConfigSchema: TensorlakeSandboxRuntimeTargetConfigSchema,
  targetSecretSchema: TensorlakeSandboxRuntimeTargetSecretSchema,
  bindingConfigSchema: TensorlakeSandboxRuntimeBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter Tensorlake API key",
          inputType: "password",
          secretType: TensorlakeSandboxRuntimeCredentialSecretTypes.API_KEY,
          slotKey: TensorlakeSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: TensorlakeSandboxRuntimeConnectionConfigSchema,
    },
  ],
  compileBinding: () => EmptyCompileBindingResult,
};
