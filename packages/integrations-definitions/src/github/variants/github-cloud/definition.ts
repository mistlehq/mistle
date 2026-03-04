import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import { IntegrationBindingEditorUiProjectionSchema } from "../../../ui/binding-editor-ui-contract.js";
import { GitHubFamilyId } from "../../shared/constants.js";
import {
  GitHubAppInstallationCredentialResolver,
  GitHubCredentialResolverKeys,
} from "../../shared/credential-resolver.js";
import { GitHubAppOAuthHandler } from "../../shared/oauth-handler.js";
import { projectGitHubBindingEditorUi } from "../../shared/project-binding-editor-ui.js";
import {
  GitHubTargetSecretSchema,
  type GitHubTargetSecrets,
} from "../../shared/target-secret-schema.js";
import { GitHubUserSecretSlots } from "../../shared/user-secret-slots.js";
import { GitHubCloudSupportedAuthSchemes } from "./auth.js";
import {
  GitHubCloudBindingConfigSchema,
  type GitHubCloudBindingConfig,
} from "./binding-config-schema.js";
import { compileGitHubCloudBinding } from "./compile-binding.js";
import {
  GitHubCloudTargetConfigSchema,
  type GitHubCloudTargetConfig,
} from "./target-config-schema.js";
import { GitHubCloudWebhookHandler } from "./webhook.js";

type GitHubCloudIntegrationDefinition = IntegrationDefinition<
  { parse: (input: unknown) => GitHubCloudTargetConfig },
  { parse: (input: unknown) => GitHubTargetSecrets },
  { parse: (input: unknown) => GitHubCloudBindingConfig }
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
  projectBindingEditorUi: () => projectGitHubBindingEditorUi(),
  bindingEditorUiProjectionSchema: IntegrationBindingEditorUiProjectionSchema,
  userSecretSlots: GitHubUserSecretSlots,
  compileBinding: compileGitHubCloudBinding,
};
