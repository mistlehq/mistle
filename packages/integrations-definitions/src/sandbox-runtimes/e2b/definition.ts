import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  E2BSandboxRuntimeCredentialSecretTypes,
  E2BSandboxRuntimeCredentialSlotKeys,
  E2BSandboxRuntimeFamilyId,
  E2BSandboxRuntimeProviderId,
  E2BSandboxRuntimeVariantId,
} from "./constants.js";
import { E2BSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";
import {
  E2BSandboxRuntimeBindingConfigSchema,
  E2BSandboxRuntimeConnectionConfigSchema,
  type E2BSandboxRuntimeConnectionConfig,
  E2BSandboxRuntimeTargetConfigSchema,
  E2BSandboxRuntimeTargetSecretSchema,
} from "./schemas.js";

type E2BSandboxRuntimeIntegrationDefinition = IntegrationDefinition<
  typeof E2BSandboxRuntimeTargetConfigSchema,
  typeof E2BSandboxRuntimeTargetSecretSchema,
  typeof E2BSandboxRuntimeBindingConfigSchema,
  E2BSandboxRuntimeConnectionConfig
>;

const EmptyCompileBindingResult: CompileBindingResult = {
  egressRoutes: [],
  artifacts: [],
  runtimeClients: [],
};

export const E2BSandboxRuntimeDefinition: E2BSandboxRuntimeIntegrationDefinition = {
  familyId: E2BSandboxRuntimeFamilyId,
  variantId: E2BSandboxRuntimeVariantId,
  kind: IntegrationKinds.SANDBOX,
  displayName: "E2B",
  description: "Run sandboxes on E2B with your organization's API keys.",
  logoKey: "e2b",
  sandboxRuntime: {
    providerId: E2BSandboxRuntimeProviderId,
    displayName: "E2B",
    resourceCapabilities: E2BSandboxRuntimeResourceCapabilities,
  },
  targetConfigSchema: E2BSandboxRuntimeTargetConfigSchema,
  targetSecretSchema: E2BSandboxRuntimeTargetSecretSchema,
  bindingConfigSchema: E2BSandboxRuntimeBindingConfigSchema,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          placeholder: "Enter E2B API key",
          inputType: "password",
          secretType: E2BSandboxRuntimeCredentialSecretTypes.API_KEY,
          slotKey: E2BSandboxRuntimeCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: E2BSandboxRuntimeConnectionConfigSchema,
    },
  ],
  compileBinding: () => EmptyCompileBindingResult,
};
