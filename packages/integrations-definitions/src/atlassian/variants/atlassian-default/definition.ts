import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";
import { z } from "zod";

import {
  AtlassianConnectionMethodIds,
  type AtlassianConnectionConfig,
  AtlassianCredentialSecretTypes,
} from "./auth.js";
import {
  AtlassianPersonalApiTokenConnectionConfigSchema,
  AtlassianServiceAccountApiTokenConnectionConfigSchema,
} from "./auth.js";
import { AtlassianBindingConfigSchema } from "./binding-config-schema.js";
import { compileAtlassianBinding } from "./compile-binding.js";
import {
  AtlassianPersonalApiTokenConnectionConfigForm,
  AtlassianServiceAccountApiTokenConnectionConfigForm,
} from "./connection-config-form.js";
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
  description: "Access Atlassian REST APIs with personal or service-account tokens.",
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
  ],
  compileBinding: compileAtlassianBinding,
};
