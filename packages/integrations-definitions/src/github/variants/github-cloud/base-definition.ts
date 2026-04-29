import {
  IntegrationFormConnectionMethodCreateBehaviors,
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
import {
  GitHubApiKeyConnectionConfigForm,
  GitHubAppInstallationConnectionConfigForm,
} from "../../shared/connection-config-form.js";
import { GitHubFamilyId } from "../../shared/constants.js";
import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { GitHubSupportedWebhookEvents } from "../../shared/supported-webhook-events.js";
import { GitHubTargetSecretSchema } from "../../shared/target-secret-schema.js";
import { GitHubCloudBindingConfigSchema } from "./binding-config-schema.js";
import { compileGitHubCloudBinding } from "./compile-binding.js";
import { GitHubCloudTargetConfigSchema } from "./target-config-schema.js";

export type GitHubCloudBaseIntegrationDefinition = IntegrationDefinition<
  typeof GitHubCloudTargetConfigSchema,
  typeof GitHubTargetSecretSchema,
  typeof GitHubCloudBindingConfigSchema,
  GitHubConnectionConfig
>;

export const GitHubCloudBaseDefinition: GitHubCloudBaseIntegrationDefinition = {
  familyId: GitHubFamilyId,
  variantId: "github-cloud",
  kind: IntegrationKinds.GIT,
  displayName: "GitHub",
  description: "Enable webhooks, repository access, and optional GitHub CLI in sandbox.",
  logoKey: "github",
  targetConfigSchema: GitHubCloudTargetConfigSchema,
  targetSecretSchema: GitHubTargetSecretSchema,
  bindingConfigSchema: GitHubCloudBindingConfigSchema,
  bindingConfigForm: resolveGitHubBindingConfigForm,
  identityLinking: {
    eligibleConnectionMethodIds: [IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION],
  },
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
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_API_KEY,
        },
      ],
      configSchema: GitHubApiKeyConnectionConfigSchema,
      configForm: GitHubApiKeyConnectionConfigForm,
    },
    {
      id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      label: "GitHub App installation",
      kind: "form",
      connectionDetail: {
        installation: {
          actionLabel: "Manage installation",
          fields: [
            {
              label: "App ID",
              source: {
                kind: "config-field",
                field: "app_id",
              },
            },
            {
              label: "App slug",
              source: {
                kind: "config-field",
                field: "app_slug",
              },
            },
            {
              label: "Installation",
              required: true,
              source: {
                kind: "first-of",
                sources: [
                  {
                    kind: "config-field",
                    field: "installation_id",
                  },
                  {
                    kind: "connection-external-subject",
                  },
                ],
              },
            },
          ],
          hideWebhookSourceSection: true,
          includeWebhookCallbackUrl: true,
          postInstallationSetupPath: "/p/integration/callbacks/setup/github-app-installation",
        },
      },
      createBehavior: IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP,
      setupFlow: {
        completionRequirements: {
          kind: "any-of",
          anyOf: [
            {
              kind: "config-field",
              field: "installation_id",
            },
            {
              kind: "connection-external-subject",
            },
          ],
        },
        routeSegment: "github-app",
      },
      secretFields: [
        {
          name: "appPrivateKeyPem",
          label: "App private key PEM",
          placeholder: "-----BEGIN PRIVATE KEY-----",
          description: "Private key from your GitHub App settings.",
          inputType: "textarea",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_PRIVATE_KEY_PEM,
        },
        {
          name: "clientSecret",
          label: "Client secret",
          placeholder: "Enter client secret",
          description: "Client secret from your GitHub App settings.",
          inputType: "password",
          secretType: "oauth2_client_secret",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
        },
        {
          name: "webhookSecret",
          label: "Webhook secret",
          placeholder: "Enter webhook secret",
          description: "Webhook secret configured on your GitHub App.",
          inputType: "password",
          secretType: "api_key",
          slotKey: GitHubCredentialSlotKeys.GITHUB_CLOUD_WEBHOOK_SECRET,
        },
      ],
      configSchema: GitHubAppInstallationConnectionConfigSchema,
      configForm: GitHubAppInstallationConnectionConfigForm,
    },
  ],
  supportedWebhookEvents: GitHubSupportedWebhookEvents,
  compileBinding: compileGitHubCloudBinding,
};
