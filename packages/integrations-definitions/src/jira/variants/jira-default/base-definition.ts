import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import {
  JiraConnectionMethodIds,
  type JiraConnectionConfig,
  JiraCredentialSecretTypes,
  JiraCredentialSlotKeys,
  JiraPersonalApiTokenConnectionConfigSchema,
  JiraServiceAccountApiTokenConnectionConfigSchema,
  JiraServiceAccountOauthClientCredentialsConnectionConfigSchema,
} from "./auth.js";
import { resolveJiraBindingConfigForm } from "./binding-config-form.js";
import { JiraBindingConfigSchema } from "./binding-config-schema.js";
import { compileJiraBinding } from "./compile-binding.js";
import {
  JiraPersonalApiTokenConnectionConfigForm,
  JiraServiceAccountApiTokenConnectionConfigForm,
  JiraServiceAccountOauthClientCredentialsConnectionConfigForm,
} from "./connection-config-form.js";
import { JiraSupportedWebhookEvents } from "./supported-webhook-events.js";
import { JiraTargetConfigSchema } from "./target-config-schema.js";
import { JiraTargetSecretSchema } from "./target-secret-schema.js";

export type JiraBaseIntegrationDefinition = IntegrationDefinition<
  typeof JiraTargetConfigSchema,
  typeof JiraTargetSecretSchema,
  typeof JiraBindingConfigSchema,
  JiraConnectionConfig
>;

export const JiraBaseDefinition: JiraBaseIntegrationDefinition = {
  familyId: "jira",
  variantId: "jira-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Jira",
  description: "Enable Jira issue access, trigger, and optional Jira CLI in sandbox.",
  logoKey: "jira",
  targetConfigSchema: JiraTargetConfigSchema,
  targetSecretSchema: JiraTargetSecretSchema,
  bindingConfigSchema: JiraBindingConfigSchema,
  bindingConfigForm: resolveJiraBindingConfigForm,
  connectionMethods: [
    {
      id: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      label: "Personal API token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Personal API token",
          placeholder: "Enter personal API token",
          inputType: "password",
          secretType: JiraCredentialSecretTypes.API_KEY,
          slotKey: JiraCredentialSlotKeys.PERSONAL_API_TOKEN_API_KEY,
        },
      ],
      configSchema: JiraPersonalApiTokenConnectionConfigSchema,
      configForm: JiraPersonalApiTokenConnectionConfigForm,
      postCreate: {
        managedWebhookSource: {
          autoCreate: true,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Jira connection and webhook created successfully",
        },
      },
    },
    {
      id: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      label: "Service account API token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Service account API token",
          placeholder: "Enter service account API token",
          inputType: "password",
          secretType: JiraCredentialSecretTypes.API_KEY,
          slotKey: JiraCredentialSlotKeys.SERVICE_ACCOUNT_API_TOKEN_API_KEY,
        },
      ],
      configSchema: JiraServiceAccountApiTokenConnectionConfigSchema,
      configForm: JiraServiceAccountApiTokenConnectionConfigForm,
    },
    {
      id: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      label: "Service account OAuth client credentials",
      kind: "form",
      secretFields: [
        {
          name: "clientSecret",
          label: "Client secret",
          placeholder: "Enter service account OAuth client secret",
          inputType: "password",
          secretType: JiraCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
          slotKey: JiraCredentialSlotKeys.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS_CLIENT_SECRET,
        },
      ],
      configSchema: JiraServiceAccountOauthClientCredentialsConnectionConfigSchema,
      configForm: JiraServiceAccountOauthClientCredentialsConnectionConfigForm,
    },
  ],
  supportedWebhookEvents: JiraSupportedWebhookEvents,
  compileBinding: compileJiraBinding,
};
