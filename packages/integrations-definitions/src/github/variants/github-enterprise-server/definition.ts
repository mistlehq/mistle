import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

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
  { parse: (input: unknown) => GitHubEnterpriseServerBindingConfig }
>;

export const GitHubEnterpriseServerDefinition: GitHubEnterpriseServerIntegrationDefinition = {
  familyId: "github",
  variantId: "github-enterprise-server",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub Enterprise Server",
  description: "GitHub Enterprise Server PAT-based integration scaffold for git/runtime routing.",
  logoKey: "github",
  targetConfigSchema: GitHubEnterpriseServerTargetConfigSchema,
  bindingConfigSchema: GitHubEnterpriseServerBindingConfigSchema,
  supportedAuthSchemes: GitHubEnterpriseServerSupportedAuthSchemes,
  triggerEventTypes: GitHubEnterpriseServerTriggerEventTypes,
  userConfigSlots: [],
  compileBinding: compileGitHubEnterpriseServerBinding,
};
