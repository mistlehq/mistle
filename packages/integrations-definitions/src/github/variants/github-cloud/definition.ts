import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import { GitHubFamilyId } from "../../shared/constants.js";
import { GitHubAppOAuthHandler } from "../../shared/oauth-handler.js";
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
  authHandlers: {
    oauth: GitHubAppOAuthHandler,
  },
  webhookHandler: GitHubCloudWebhookHandler,
  userConfigSlots: [],
  userSecretSlots: GitHubUserSecretSlots,
  compileBinding: compileGitHubCloudBinding,
};
