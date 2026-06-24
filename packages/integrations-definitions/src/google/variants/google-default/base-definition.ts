import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import {
  type GoogleConnectionConfig,
  GoogleConnectionMethodIds,
  GoogleConnectionStartConfigSchema,
  GoogleCredentialSecretTypes,
  GoogleDefaultVariantId,
  GoogleFamilyId,
  GoogleOAuthConnectionConfigSchema,
  GoogleServiceAccountConnectionConfigSchema,
  GoogleServiceAccountCredentialSlotKeys,
  GoogleServiceAccountDomainWideDelegationConnectionConfigSchema,
} from "./auth.js";
import { resolveGoogleBindingConfigForm } from "./binding-config-form.js";
import { GoogleBindingConfigSchema } from "./binding-config-schema.js";
import { resolveGoogleCapabilityMcpServers } from "./capabilities/compile.js";
import { compileGoogleBinding } from "./compile-binding.js";
import {
  GoogleServiceAccountConnectionConfigForm,
  GoogleServiceAccountDomainWideDelegationConnectionConfigForm,
} from "./connection-config-form.js";
import { GoogleTargetConfigSchema } from "./target-config-schema.js";
import { GoogleTargetSecretSchema } from "./target-secret-schema.js";

export type GoogleBaseIntegrationDefinition = IntegrationDefinition<
  typeof GoogleTargetConfigSchema,
  typeof GoogleTargetSecretSchema,
  typeof GoogleBindingConfigSchema,
  GoogleConnectionConfig
>;

export const GoogleBaseDefinition: GoogleBaseIntegrationDefinition = {
  familyId: GoogleFamilyId,
  variantId: GoogleDefaultVariantId,
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Google",
  description: "Central Google credentials for OAuth and service-account backed capabilities.",
  logoKey: "google",
  targetConfigSchema: GoogleTargetConfigSchema,
  targetSecretSchema: GoogleTargetSecretSchema,
  bindingConfigSchema: GoogleBindingConfigSchema,
  bindingConfigForm: resolveGoogleBindingConfigForm,
  connectionMethods: [
    {
      id: GoogleConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Google OAuth",
      kind: "redirect",
      configSchema: GoogleOAuthConnectionConfigSchema,
      startConfigSchema: GoogleConnectionStartConfigSchema,
      startConfigForm: () => ({
        schema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              title: "OAuth client ID",
            },
            client_secret: {
              type: "string",
              title: "OAuth client secret",
            },
            scopes: {
              type: "array",
              title: "OAuth scopes",
              items: {
                type: "string",
              },
              minItems: 1,
            },
          },
          required: ["client_id", "client_secret", "scopes"],
        },
        uiSchema: {
          client_id: {
            "ui:placeholder": "1234567890-abc.apps.googleusercontent.com",
          },
          client_secret: {
            "ui:widget": "password",
          },
          scopes: {
            "ui:options": {
              orderable: false,
            },
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect Google",
          helperText: "Authorize Google access once, then use the connection for selected tools.",
          showCallbackUrl: true,
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
    {
      id: GoogleConnectionMethodIds.SERVICE_ACCOUNT,
      label: "Service account",
      kind: "form",
      secretFields: [
        {
          name: "serviceAccountKeyJson",
          label: "Service account JSON key",
          placeholder: '{"type":"service_account",...}',
          description: "JSON key for a Google Cloud service account.",
          inputType: "textarea",
          secretType: GoogleCredentialSecretTypes.SERVICE_ACCOUNT_KEY_JSON,
          slotKey: GoogleServiceAccountCredentialSlotKeys.SERVICE_ACCOUNT_KEY_JSON,
        },
      ],
      configSchema: GoogleServiceAccountConnectionConfigSchema,
      configForm: GoogleServiceAccountConnectionConfigForm,
    },
    {
      id: GoogleConnectionMethodIds.SERVICE_ACCOUNT_DOMAIN_WIDE_DELEGATION,
      label: "Service account with domain-wide delegation",
      kind: "form",
      secretFields: [
        {
          name: "serviceAccountKeyJson",
          label: "Service account JSON key",
          placeholder: '{"type":"service_account",...}',
          description: "JSON key for a Google Cloud service account with delegated access.",
          inputType: "textarea",
          secretType: GoogleCredentialSecretTypes.SERVICE_ACCOUNT_KEY_JSON,
          slotKey: GoogleServiceAccountCredentialSlotKeys.SERVICE_ACCOUNT_KEY_JSON,
        },
      ],
      configSchema: GoogleServiceAccountDomainWideDelegationConnectionConfigSchema,
      configForm: GoogleServiceAccountDomainWideDelegationConnectionConfigForm,
    },
  ],
  mcp: resolveGoogleCapabilityMcpServers,
  compileBinding: compileGoogleBinding,
};
