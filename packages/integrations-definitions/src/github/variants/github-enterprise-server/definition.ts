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
import { GitHubEnterpriseServerBindingConfigSchema } from "./binding-config-schema.js";
import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";
import { GitHubEnterpriseServerTargetConfigSchema } from "./target-config-schema.js";
import { GitHubEnterpriseServerWebhookHandler } from "./webhook.js";

type GitHubEnterpriseServerIntegrationDefinition = IntegrationDefinition<
  typeof GitHubEnterpriseServerTargetConfigSchema,
  typeof GitHubTargetSecretSchema,
  typeof GitHubEnterpriseServerBindingConfigSchema,
  GitHubConnectionConfig
>;

export const GitHubEnterpriseServerDefinition: GitHubEnterpriseServerIntegrationDefinition = {
  familyId: GitHubFamilyId,
  variantId: "github-enterprise-server",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub Enterprise Server",
  description: "Enable webhooks, repository access, GitHub CLI in sandbox.",
  logoKey: "github",
  targetConfigSchema: GitHubEnterpriseServerTargetConfigSchema,
  targetSecretSchema: GitHubTargetSecretSchema,
  bindingConfigSchema: GitHubEnterpriseServerBindingConfigSchema,
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
  webhookHandler: GitHubEnterpriseServerWebhookHandler,
  resourceDefinitions: GitHubResourceDefinitions,
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
  compileBinding: compileGitHubEnterpriseServerBinding,
};
