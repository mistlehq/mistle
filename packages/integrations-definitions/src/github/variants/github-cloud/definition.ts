import {
  IntegrationConnectionMethodIds,
  IntegrationConnectionMethodKinds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GitHubConnectionConfig,
  GitHubApiKeyConnectionConfigSchema,
  GitHubAppInstallationConnectionConfigSchema,
} from "../../shared/auth.js";
import { resolveGitHubBindingConfigForm } from "../../shared/binding-config-form.js";
import { GitHubFamilyId } from "../../shared/constants.js";
import {
  GitHubAppInstallationCredentialResolver,
  GitHubCredentialResolverKeys,
} from "../../shared/credential-resolver.js";
import { GitHubAppInstallationRedirectHandler } from "../../shared/github-app-installation-handler.js";
import { listGitHubConnectionResources } from "../../shared/list-connection-resources.js";
import {
  GitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { GitHubTargetSecretSchema } from "../../shared/target-secret-schema.js";
import { GitHubCloudBindingConfigSchema } from "./binding-config-schema.js";
import { compileGitHubCloudBinding } from "./compile-binding.js";
import { GitHubCloudTargetConfigSchema } from "./target-config-schema.js";
import { GitHubCloudWebhookHandler } from "./webhook.js";

type GitHubCloudIntegrationDefinition = IntegrationDefinition<
  typeof GitHubCloudTargetConfigSchema,
  typeof GitHubTargetSecretSchema,
  typeof GitHubCloudBindingConfigSchema,
  GitHubConnectionConfig
>;

export const GitHubCloudDefinition: GitHubCloudIntegrationDefinition = {
  familyId: GitHubFamilyId,
  variantId: "github-cloud",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub",
  description: "Enable webhooks, repository access, GitHub CLI in sandbox.",
  logoKey: "github",
  targetConfigSchema: GitHubCloudTargetConfigSchema,
  targetSecretSchema: GitHubTargetSecretSchema,
  bindingConfigSchema: GitHubCloudBindingConfigSchema,
  bindingConfigForm: resolveGitHubBindingConfigForm,
  connectionMethods: [
    {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: IntegrationConnectionMethodKinds.API_KEY,
      configSchema: GitHubApiKeyConnectionConfigSchema,
    },
    {
      id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      label: "GitHub App installation",
      kind: IntegrationConnectionMethodKinds.REDIRECT,
      configSchema: GitHubAppInstallationConnectionConfigSchema,
    },
  ],
  credentialResolvers: {
    custom: {
      [GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN]:
        GitHubAppInstallationCredentialResolver,
    },
  },
  authHandlers: {
    oauth: GitHubAppInstallationRedirectHandler,
  },
  webhookHandler: GitHubCloudWebhookHandler,
  resourceDefinitions: GitHubResourceDefinitions,
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
  compileBinding: compileGitHubCloudBinding,
};
