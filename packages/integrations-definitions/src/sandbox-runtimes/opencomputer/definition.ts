import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { resolveOpenComputerBindingConfigForm } from "./binding-config-form.js";
import { compileOpenComputerBinding } from "./compile-binding.js";
import {
  OpenComputerSandboxRuntimeCredentialSecretTypes,
  OpenComputerSandboxRuntimeCredentialSlotKeys,
  OpenComputerSandboxRuntimeFamilyId,
  OpenComputerSandboxRuntimeProviderId,
  OpenComputerSandboxRuntimeVariantId,
} from "./constants.js";
import { OpenComputerSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";
import {
  OpenComputerSandboxRuntimeBindingConfigSchema,
  OpenComputerSandboxRuntimeConnectionConfigSchema,
  type OpenComputerSandboxRuntimeConnectionConfig,
  OpenComputerSandboxRuntimeTargetConfigSchema,
  OpenComputerSandboxRuntimeTargetSecretSchema,
} from "./schemas.js";

type OpenComputerSandboxRuntimeIntegrationDefinition = IntegrationDefinition<
  typeof OpenComputerSandboxRuntimeTargetConfigSchema,
  typeof OpenComputerSandboxRuntimeTargetSecretSchema,
  typeof OpenComputerSandboxRuntimeBindingConfigSchema,
  OpenComputerSandboxRuntimeConnectionConfig
>;

export const OpenComputerSandboxRuntimeDefinition: OpenComputerSandboxRuntimeIntegrationDefinition =
  {
    familyId: OpenComputerSandboxRuntimeFamilyId,
    variantId: OpenComputerSandboxRuntimeVariantId,
    kind: IntegrationKinds.SANDBOX,
    displayName: "OpenComputer",
    description: "Run sandboxes on OpenComputer with your organization's API key.",
    logoKey: "opencomputer",
    sandboxRuntime: {
      providerId: OpenComputerSandboxRuntimeProviderId,
      displayName: "OpenComputer",
      resourceCapabilities: OpenComputerSandboxRuntimeResourceCapabilities,
    },
    targetConfigSchema: OpenComputerSandboxRuntimeTargetConfigSchema,
    targetSecretSchema: OpenComputerSandboxRuntimeTargetSecretSchema,
    bindingConfigSchema: OpenComputerSandboxRuntimeBindingConfigSchema,
    bindingConfigForm: resolveOpenComputerBindingConfigForm,
    connectionMethods: [
      {
        id: IntegrationConnectionMethodIds.API_KEY,
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            placeholder: "Enter OpenComputer API key",
            inputType: "password",
            secretType: OpenComputerSandboxRuntimeCredentialSecretTypes.API_KEY,
            slotKey: OpenComputerSandboxRuntimeCredentialSlotKeys.API_KEY,
          },
        ],
        configSchema: OpenComputerSandboxRuntimeConnectionConfigSchema,
      },
    ],
    compileBinding: compileOpenComputerBinding,
  };
