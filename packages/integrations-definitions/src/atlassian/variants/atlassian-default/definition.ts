import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import {
  AtlassianConnectionMethodIds,
  type AtlassianConnectionConfig,
  AtlassianCredentialSecretTypes,
  AtlassianPersonalApiTokenConnectionConfigSchema,
  AtlassianServiceAccountApiTokenConnectionConfigSchema,
  AtlassianServiceAccountOauthClientCredentialsConnectionConfigSchema,
} from "./auth.js";
import { AtlassianBindingConfigSchema } from "./binding-config-schema.js";
import { compileAtlassianBinding } from "./compile-binding.js";
import {
  AtlassianPersonalApiTokenConnectionConfigForm,
  AtlassianServiceAccountApiTokenConnectionConfigForm,
  AtlassianServiceAccountOauthClientCredentialsConnectionConfigForm,
} from "./connection-config-form.js";
import { exchangeAtlassianClientCredentials } from "./oauth2-client-credentials.js";
import { AtlassianTargetConfigSchema } from "./target-config-schema.js";

type AtlassianIntegrationDefinition = IntegrationDefinition<
  typeof AtlassianTargetConfigSchema,
  typeof AtlassianTargetSecretSchema,
  typeof AtlassianBindingConfigSchema,
  AtlassianConnectionConfig
>;

const AtlassianTargetSecretSchema = z.object({}).strict();

export const AtlassianDefinition: AtlassianIntegrationDefinition = {
  familyId: "atlassian",
  variantId: "atlassian-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Atlassian",
  description:
    "Access Atlassian REST APIs with personal tokens, service-account tokens, or service-account OAuth client credentials.",
  logoKey: "atlassian",
  targetConfigSchema: AtlassianTargetConfigSchema,
  targetSecretSchema: AtlassianTargetSecretSchema,
  bindingConfigSchema: AtlassianBindingConfigSchema,
  connectionMethods: [
    {
      id: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
      label: "Personal API token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Personal API token",
          placeholder: "Enter personal API token",
          inputType: "password",
          secretType: AtlassianCredentialSecretTypes.API_KEY,
        },
      ],
      configSchema: AtlassianPersonalApiTokenConnectionConfigSchema,
      configForm: AtlassianPersonalApiTokenConnectionConfigForm,
    },
    {
      id: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      label: "Service account API token",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "Service account API token",
          placeholder: "Enter service account API token",
          inputType: "password",
          secretType: AtlassianCredentialSecretTypes.API_KEY,
        },
      ],
      configSchema: AtlassianServiceAccountApiTokenConnectionConfigSchema,
      configForm: AtlassianServiceAccountApiTokenConnectionConfigForm,
    },
    {
      id: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      label: "Service account OAuth client credentials",
      kind: "form",
      secretFields: [
        {
          name: "clientSecret",
          label: "Client secret",
          placeholder: "Enter service account OAuth client secret",
          inputType: "password",
          secretType: AtlassianCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
        },
      ],
      configSchema: AtlassianServiceAccountOauthClientCredentialsConnectionConfigSchema,
      configForm: AtlassianServiceAccountOauthClientCredentialsConnectionConfigForm,
    },
  ],
  oauth2ClientCredentials: {
    exchangeClientCredentials: exchangeAtlassianClientCredentials,
  },
  compileBinding: compileAtlassianBinding,
};
