import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

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
import { GitHubCloudTriggerEventTypes } from "./webhook.js";

type GitHubCloudIntegrationDefinition = IntegrationDefinition<
  { parse: (input: unknown) => GitHubCloudTargetConfig },
  { parse: (input: unknown) => GitHubCloudBindingConfig }
>;

export const GitHubCloudDefinition: GitHubCloudIntegrationDefinition = {
  familyId: "github",
  variantId: "github-cloud",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub",
  description: "GitHub Cloud integration scaffold for PAT and GitHub App auth modes.",
  logoKey: "github",
  targetConfigSchema: GitHubCloudTargetConfigSchema,
  bindingConfigSchema: GitHubCloudBindingConfigSchema,
  supportedAuthSchemes: GitHubCloudSupportedAuthSchemes,
  triggerEventTypes: GitHubCloudTriggerEventTypes,
  userConfigSlots: [],
  compileBinding: compileGitHubCloudBinding,
};
