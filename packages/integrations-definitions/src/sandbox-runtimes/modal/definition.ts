import {
  IntegrationKinds,
  type CompileBindingResult,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  ModalSandboxRuntimeFamilyId,
  ModalSandboxRuntimeProviderId,
  ModalSandboxRuntimeVariantId,
} from "./constants.js";
import { ModalSandboxRuntimeResourceCapabilities } from "./runtime-capabilities.js";
import {
  ModalSandboxRuntimeBindingConfigSchema,
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
  description: "Run sandboxes on Modal VM Sandboxes with deployment-managed credentials.",
  logoKey: "modal",
  sandboxRuntime: {
    providerId: ModalSandboxRuntimeProviderId,
    displayName: "Modal",
    resourceCapabilities: ModalSandboxRuntimeResourceCapabilities,
  },
  targetConfigSchema: ModalSandboxRuntimeTargetConfigSchema,
  targetSecretSchema: ModalSandboxRuntimeTargetSecretSchema,
  bindingConfigSchema: ModalSandboxRuntimeBindingConfigSchema,
  connectionMethods: [],
  compileBinding: () => EmptyCompileBindingResult,
};
