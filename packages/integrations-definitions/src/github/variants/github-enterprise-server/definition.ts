import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import { GitHubFamilyId } from "../../shared/constants.js";
import { GitHubAppOAuthHandler } from "../../shared/oauth-handler.js";
import {
  GitHubTargetSecretSchema,
  type GitHubTargetSecrets,
} from "../../shared/target-secret-schema.js";
import { GitHubUserSecretSlots } from "../../shared/user-secret-slots.js";
import { GitHubEnterpriseServerSupportedAuthSchemes } from "./auth.js";
import {
  GitHubEnterpriseServerBindingConfigSchema,
  type GitHubEnterpriseServerBindingConfig,
} from "./binding-config-schema.js";
import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";
import {
  GitHubEnterpriseServerTargetConfigSchema,
  type GitHubEnterpriseServerTargetConfig,
} from "./target-config-schema.js";
import { GitHubEnterpriseServerWebhookHandler } from "./webhook.js";

type GitHubEnterpriseServerIntegrationDefinition = IntegrationDefinition<
  { parse: (input: unknown) => GitHubEnterpriseServerTargetConfig },
  { parse: (input: unknown) => GitHubTargetSecrets },
  { parse: (input: unknown) => GitHubEnterpriseServerBindingConfig }
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
  supportedAuthSchemes: GitHubEnterpriseServerSupportedAuthSchemes,
  authHandlers: {
    oauth: GitHubAppOAuthHandler,
  },
  webhookHandler: GitHubEnterpriseServerWebhookHandler,
  userConfigSlots: [],
  userSecretSlots: GitHubUserSecretSlots,
  compileBinding: compileGitHubEnterpriseServerBinding,
};
