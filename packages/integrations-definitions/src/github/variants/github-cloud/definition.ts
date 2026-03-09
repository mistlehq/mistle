import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import { GitHubConnectionConfigSchema } from "../../shared/auth.js";
import { resolveGitHubBindingConfigForm } from "../../shared/binding-config-form.js";
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
import { GitHubCloudSupportedAuthSchemes } from "./auth.js";
import { GitHubCloudBindingConfigSchema } from "./binding-config-schema.js";
import { compileGitHubCloudBinding } from "./compile-binding.js";
import { GitHubCloudTargetConfigSchema } from "./target-config-schema.js";
import { GitHubCloudWebhookHandler } from "./webhook.js";

type GitHubCloudIntegrationDefinition = IntegrationDefinition<
  typeof GitHubCloudTargetConfigSchema,
  typeof GitHubTargetSecretSchema,
  typeof GitHubCloudBindingConfigSchema,
  typeof GitHubConnectionConfigSchema
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
  connectionConfigSchema: GitHubConnectionConfigSchema,
  supportedAuthSchemes: GitHubCloudSupportedAuthSchemes,
  credentialResolvers: {
    custom: {
      [GitHubCredentialResolverKeys.GITHUB_APP_INSTALLATION_TOKEN]:
        GitHubAppInstallationCredentialResolver,
    },
  },
  authHandlers: {
    oauth: GitHubAppOAuthHandler,
  },
  webhookHandler: GitHubCloudWebhookHandler,
  resourceDefinitions: GitHubResourceDefinitions,
  resourceSyncTriggers: GitHubResourceSyncTriggers,
  listConnectionResources: listGitHubConnectionResources,
  compileBinding: compileGitHubCloudBinding,
};
