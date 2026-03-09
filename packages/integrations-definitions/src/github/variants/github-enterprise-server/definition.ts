import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema } from "../../shared/auth.js";
import { GitHubBindingConfigForm } from "../../shared/binding-config-form.js";
import { GitHubFamilyId } from "../../shared/constants.js";
import {
  GitHubAppInstallationCredentialResolver,
  GitHubCredentialResolverKeys,
} from "../../shared/credential-resolver.js";
import { listGitHubConnectionResources } from "../../shared/list-connection-resources.js";
import { GitHubAppOAuthHandler } from "../../shared/oauth-handler.js";
import {
  GitHubResourceDefinitions,
  GitHubResourceSyncTriggers,
} from "../../shared/resource-definitions.js";
import { GitHubTargetSecretSchema } from "../../shared/target-secret-schema.js";
import { GitHubEnterpriseServerSupportedAuthSchemes } from "./auth.js";
import { GitHubEnterpriseServerBindingConfigSchema } from "./binding-config-schema.js";
import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";
import { GitHubEnterpriseServerTargetConfigSchema } from "./target-config-schema.js";
import { GitHubEnterpriseServerWebhookHandler } from "./webhook.js";

type GitHubEnterpriseServerIntegrationDefinition = IntegrationDefinition<
  typeof GitHubEnterpriseServerTargetConfigSchema,
  typeof GitHubTargetSecretSchema,
  typeof GitHubEnterpriseServerBindingConfigSchema,
  typeof GitHubConnectionConfigSchema
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
  bindingConfigForm: GitHubBindingConfigForm,
  connectionConfigSchema: GitHubConnectionConfigSchema,
  supportedAuthSchemes: GitHubEnterpriseServerSupportedAuthSchemes,
  credentialResolvers: {
    custom: {
      [GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN]:
        GitHubAppInstallationCredentialResolver,
    },
  },
  authHandlers: {
    oauth: GitHubAppOAuthHandler,
  },
  webhookHandler: GitHubEnterpriseServerWebhookHandler,
  resourceDefinitions: GitHubResourceDefinitions,
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
  compileBinding: compileGitHubEnterpriseServerBinding,
};
