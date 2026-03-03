import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import { GitHubAppOAuthHandler } from "../../shared/oauth-handler.js";
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
  { parse: (input: unknown) => Record<string, never> },
  { parse: (input: unknown) => GitHubCloudBindingConfig }
>;

const GitHubCloudTargetSecretSchema = z.object({}).strict();

export const GitHubCloudDefinition: GitHubCloudIntegrationDefinition = {
  familyId: "github",
  variantId: "github-cloud",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub",
  description: "GitHub Cloud integration scaffold for PAT and GitHub App auth modes.",
  logoKey: "github",
  targetConfigSchema: GitHubCloudTargetConfigSchema,
  targetSecretSchema: GitHubCloudTargetSecretSchema,
  bindingConfigSchema: GitHubCloudBindingConfigSchema,
  supportedAuthSchemes: GitHubCloudSupportedAuthSchemes,
  authHandlers: {
    oauth: GitHubAppOAuthHandler,
  },
  triggerEventTypes: GitHubCloudTriggerEventTypes,
  userConfigSlots: [],
  compileBinding: compileGitHubCloudBinding,
};
