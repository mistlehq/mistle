import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import {
  type GitHubConnectionConfig,
  GitHubApiKeyConnectionConfigSchema,
  GitHubAppInstallationConnectionConfigSchema,
} from "../../shared/auth.js";
import { resolveGitHubBindingConfigForm } from "../../shared/binding-config-form.js";
import { GitHubApiKeyConnectionConfigForm } from "../../shared/connection-config-form.js";
import { GitHubFamilyId } from "../../shared/constants.js";
import { GitHubSupportedWebhookEvents } from "../../shared/supported-webhook-events.js";
import { GitHubTargetSecretSchema } from "../../shared/target-secret-schema.js";
import { GitHubEnterpriseServerBindingConfigSchema } from "./binding-config-schema.js";
import { compileGitHubEnterpriseServerBinding } from "./compile-binding.js";
import { GitHubEnterpriseServerTargetConfigSchema } from "./target-config-schema.js";

export type GitHubEnterpriseServerBaseIntegrationDefinition = IntegrationDefinition<
  typeof GitHubEnterpriseServerTargetConfigSchema,
  typeof GitHubTargetSecretSchema,
  typeof GitHubEnterpriseServerBindingConfigSchema,
  GitHubConnectionConfig
>;

export const GitHubEnterpriseServerBaseDefinition: GitHubEnterpriseServerBaseIntegrationDefinition =
  {
    familyId: GitHubFamilyId,
    variantId: "github-enterprise-server",
    kind: IntegrationKinds.GIT,
    displayName: "GitHub Enterprise Server",
    description: "Enable webhooks, repository access, and optional GitHub CLI in sandbox.",
    logoKey: "github",
    targetConfigSchema: GitHubEnterpriseServerTargetConfigSchema,
    targetSecretSchema: GitHubTargetSecretSchema,
    bindingConfigSchema: GitHubEnterpriseServerBindingConfigSchema,
    bindingConfigForm: resolveGitHubBindingConfigForm,
    connectionMethods: [
      {
        id: IntegrationConnectionMethodIds.API_KEY,
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            placeholder: "Enter API key",
            inputType: "password",
            secretType: "api_key",
          },
        ],
        configSchema: GitHubApiKeyConnectionConfigSchema,
        configForm: GitHubApiKeyConnectionConfigForm,
      },
      {
        id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        label: "GitHub App installation",
        kind: "redirect",
        ui: {
          create: {
            submitLabel: "Install GitHub App",
            helperText: "Continue to GitHub to install the app and finish connecting this account.",
          },
        },
        configSchema: GitHubAppInstallationConnectionConfigSchema,
      },
    ],
    supportedWebhookEvents: GitHubSupportedWebhookEvents,
    compileBinding: compileGitHubEnterpriseServerBinding,
  };
