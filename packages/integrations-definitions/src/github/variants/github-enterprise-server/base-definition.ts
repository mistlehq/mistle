import {
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { buildGitHubAppManifestDraft } from "../../shared/app-manifest.js";
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
import {
  createGitHubProviderAppSetupMetadata,
  GitHubProviderAppSetupPane,
  GitHubProviderAppSetupStartForm,
} from "../../shared/provider-app-setup-metadata.js";
import { GitHubAppInstallationSetupPath } from "../../shared/provider-app-setup-routes.js";
import { GitHubCredentialSlotKeys } from "../../shared/slot-keys.js";
import { GitHubSupportedWebhookEvents } from "../../shared/supported-webhook-events.js";
import { GitHubTargetSecretSchema } from "../../shared/target-secret-schema.js";
import { GitHubWebhookTriggerCapabilitiesRefreshUi } from "../../shared/webhook-trigger-capabilities-refresh-ui.js";
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
            slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_API_KEY,
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
            includeWebhookCallbackUrl: true,
            postInstallationSetupPath: GitHubAppInstallationSetupPath,
          },
        },
        createBehavior: IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP,
        setupFlow: {
          appManifestDraft: {
            build: buildGitHubAppManifestDraft,
          },
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
          providerAppSetup: createGitHubProviderAppSetupMetadata({
            supportsClientSecret: false,
          }),
          routeSegment: "github-app",
          setupPane: GitHubProviderAppSetupPane,
          startForm: GitHubProviderAppSetupStartForm,
        },
        secretFields: [
          {
            name: "appPrivateKeyPem",
            label: "App private key PEM",
            placeholder: "-----BEGIN PRIVATE KEY-----",
            description: "Private key from your GitHub App settings.",
            inputType: "textarea",
            secretType: "api_key",
            slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_APP_PRIVATE_KEY_PEM,
          },
          {
            name: "webhookSecret",
            label: "Webhook secret",
            placeholder: "Enter webhook secret",
            description: "Webhook secret configured on your GitHub App.",
            inputType: "password",
            secretType: "api_key",
            slotKey: GitHubCredentialSlotKeys.GITHUB_ENTERPRISE_SERVER_WEBHOOK_SECRET,
          },
        ],
        configSchema: GitHubAppInstallationConnectionConfigSchema,
        configForm: GitHubAppInstallationConnectionConfigForm,
      },
    ],
    supportedWebhookEvents: GitHubSupportedWebhookEvents,
    webhookTriggerCapabilitiesRefreshUi: GitHubWebhookTriggerCapabilitiesRefreshUi,
    compileBinding: compileGitHubEnterpriseServerBinding,
  };
