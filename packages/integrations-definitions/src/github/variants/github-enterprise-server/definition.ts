import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import { GitHubAppOAuthHandler } from "../../shared/oauth-handler.js";
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
import { GitHubEnterpriseServerTriggerEventTypes } from "./webhook.js";

type GitHubEnterpriseServerIntegrationDefinition = IntegrationDefinition<
  { parse: (input: unknown) => GitHubEnterpriseServerTargetConfig },
  { parse: (input: unknown) => Record<string, never> },
  { parse: (input: unknown) => GitHubEnterpriseServerBindingConfig }
>;

const GitHubEnterpriseServerTargetSecretSchema = z.object({}).strict();

export const GitHubEnterpriseServerDefinition: GitHubEnterpriseServerIntegrationDefinition = {
  familyId: "github",
  variantId: "github-enterprise-server",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub Enterprise Server",
  description: "GitHub Enterprise Server integration scaffold for PAT and GitHub App auth modes.",
  logoKey: "github",
  targetConfigSchema: GitHubEnterpriseServerTargetConfigSchema,
  targetSecretSchema: GitHubEnterpriseServerTargetSecretSchema,
  bindingConfigSchema: GitHubEnterpriseServerBindingConfigSchema,
  supportedAuthSchemes: GitHubEnterpriseServerSupportedAuthSchemes,
  authHandlers: {
    oauth: GitHubAppOAuthHandler,
  },
  triggerEventTypes: GitHubEnterpriseServerTriggerEventTypes,
  userConfigSlots: [],
  compileBinding: compileGitHubEnterpriseServerBinding,
};
