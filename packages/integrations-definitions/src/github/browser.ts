export { GitHubApiMethods, GitHubFamilyId } from "./shared/constants.js";
export {
  GitHubApiKeyConnectionConfigSchema,
  GitHubAppInstallationConnectionConfigSchema,
  GitHubConnectionConfigSchema,
  GitHubCredentialSecretTypes,
  type GitHubConnectionConfig,
  type GitHubCredentialSecretType,
  resolveGitHubCredentialSecretType,
} from "./shared/auth.js";
export { GitHubSupportedWebhookEvents } from "./shared/supported-webhook-events.js";
export {
  GitHubBindingConfigSchema,
  type GitHubBindingConfig,
} from "./shared/binding-config-schema.js";
export {
  GitHubTargetConfigSchema,
  type GitHubTargetConfig,
} from "./shared/target-config-schema.js";
export {
  GitHubTargetSecretSchema,
  type GitHubTargetSecrets,
} from "./shared/target-secret-schema.js";
export { compileGitHubBinding, type GitHubCompileBindingInput } from "./shared/compile-binding.js";
export { resolveGitHubBindingConfigForm } from "./shared/binding-config-form.js";
export { GitHubCredentialResolverKeys } from "./shared/credential-resolver-keys.js";
export { GitHubCredentialSlotKeys } from "./shared/slot-keys.js";
export {
  createGitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "./shared/resource-definitions.js";
export {
  GitHubCloudBaseDefinition,
  GitHubCloudBaseDefinition as GitHubCloudDefinition,
} from "./variants/github-cloud/base-definition.js";
export {
  GitHubCloudTargetConfigSchema,
  type GitHubCloudTargetConfig,
} from "./variants/github-cloud/target-config-schema.js";
export {
  GitHubCloudBindingConfigSchema,
  type GitHubCloudBindingConfig,
} from "./variants/github-cloud/binding-config-schema.js";
export { compileGitHubCloudBinding } from "./variants/github-cloud/compile-binding.js";
export { GitHubCloudCredentialSecretTypes } from "./variants/github-cloud/auth.js";
export {
  GitHubEnterpriseServerBaseDefinition,
  GitHubEnterpriseServerBaseDefinition as GitHubEnterpriseServerDefinition,
} from "./variants/github-enterprise-server/base-definition.js";
export {
  GitHubEnterpriseServerTargetConfigSchema,
  type GitHubEnterpriseServerTargetConfig,
} from "./variants/github-enterprise-server/target-config-schema.js";
export {
  GitHubEnterpriseServerBindingConfigSchema,
  type GitHubEnterpriseServerBindingConfig,
} from "./variants/github-enterprise-server/binding-config-schema.js";
export { compileGitHubEnterpriseServerBinding } from "./variants/github-enterprise-server/compile-binding.js";
export { GitHubEnterpriseServerCredentialSecretTypes } from "./variants/github-enterprise-server/auth.js";
