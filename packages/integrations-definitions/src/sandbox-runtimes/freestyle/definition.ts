import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  FreestyleSandboxRuntimeCredentialSecretTypes,
  FreestyleSandboxRuntimeCredentialSlotKeys,
  FreestyleSandboxRuntimeFamilyId,
  FreestyleSandboxRuntimeProviderId,
  FreestyleSandboxRuntimeVariantId,
} from "./constants.js";
import { FreestyleSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";
import {
  FreestyleSandboxRuntimeBindingConfigSchema,
  FreestyleSandboxRuntimeConnectionConfigSchema,
  type FreestyleSandboxRuntimeConnectionConfig,
  FreestyleSandboxRuntimeTargetConfigSchema,
  FreestyleSandboxRuntimeTargetSecretSchema,
} from "./schemas.js";

type FreestyleSandboxRuntimeIntegrationDefinition = IntegrationDefinition<
  typeof FreestyleSandboxRuntimeTargetConfigSchema,
  typeof FreestyleSandboxRuntimeTargetSecretSchema,
  typeof FreestyleSandboxRuntimeBindingConfigSchema,
  FreestyleSandboxRuntimeConnectionConfig
>;

const EmptyCompileBindingResult: CompileBindingResult = {
  egressRoutes: [],
  artifacts: [],
  runtimeClients: [],
};

export const FreestyleSandboxRuntimeDefinition: FreestyleSandboxRuntimeIntegrationDefinition = {
  familyId: FreestyleSandboxRuntimeFamilyId,
  variantId: FreestyleSandboxRuntimeVariantId,
  kind: IntegrationKinds.SANDBOX,
  displayName: "Freestyle",
  description: "Run sandboxes on Freestyle VMs with your organization's API keys.",
  logoKey: "freestyle",
  sandboxRuntime: {
    providerId: FreestyleSandboxRuntimeProviderId,
    displayName: "Freestyle",
    resourceCapabilities: FreestyleSandboxRuntimeResourceCapabilities,
  },
  targetConfigSchema: FreestyleSandboxRuntimeTargetConfigSchema,
  targetSecretSchema: FreestyleSandboxRuntimeTargetSecretSchema,
  bindingConfigSchema: FreestyleSandboxRuntimeBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter Freestyle API key",
          inputType: "password",
          secretType: FreestyleSandboxRuntimeCredentialSecretTypes.API_KEY,
          slotKey: FreestyleSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: FreestyleSandboxRuntimeConnectionConfigSchema,
    },
  ],
  compileBinding: () => EmptyCompileBindingResult,
};
