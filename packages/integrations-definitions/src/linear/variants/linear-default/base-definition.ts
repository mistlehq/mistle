import {
  IntegrationConnectionMethodIds,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";
import { z } from "zod";

import {
  type LinearConnectionConfig,
  LinearApiKeyConnectionConfigSchema,
  LinearOAuth2ConnectionConfigSchema,
  LinearOAuth2ConnectionStartConfigSchema,
  LinearOAuthAppConnectionConfigSchema,
  LinearConnectionMethodIds,
  LinearCredentialSecretTypes,
  LinearCredentialSlotKeys,
} from "./auth.js";
import { resolveLinearBindingConfigForm } from "./binding-config-form.js";
import { LinearBindingConfigSchema } from "./binding-config-schema.js";
import { compileLinearBinding } from "./compile-binding.js";
import {
  LinearApiKeyConnectionConfigForm,
  LinearOAuthAppConnectionConfigForm,
} from "./connection-config-form.js";
import { LinearSupportedWebhookEvents } from "./supported-webhook-events.js";
import { LinearTargetConfigSchema } from "./target-config-schema.js";
import { LinearToolIds } from "./tool-ids.js";
import { validateLinearBindingWriteContext } from "./validate-binding-write-context.js";

const LinearTargetSecretSchema = z.object({}).strict();

export type LinearBaseIntegrationDefinition = IntegrationDefinition<
  typeof LinearTargetConfigSchema,
  typeof LinearTargetSecretSchema,
  typeof LinearBindingConfigSchema,
  LinearConnectionConfig
>;

export const LinearBaseDefinition: LinearBaseIntegrationDefinition = {
  familyId: "linear",
  variantId: "linear-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Linear",
  description: "Enable access to Linear issues, projects, and workflows from agents.",
  logoKey: "linear",
  targetConfigSchema: LinearTargetConfigSchema,
  targetSecretSchema: LinearTargetSecretSchema,
  bindingConfigSchema: LinearBindingConfigSchema,
  bindingConfigForm: resolveLinearBindingConfigForm,
  validateBindingWriteContext: validateLinearBindingWriteContext,
  identityLinking: {
    eligibleConnectionMethodIds: [LinearConnectionMethodIds.OAUTH_APP],
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
          slotKey: LinearCredentialSlotKeys.API_KEY,
        },
      ],
      configSchema: LinearApiKeyConnectionConfigSchema,
      configForm: LinearApiKeyConnectionConfigForm,
      postCreate: {
        managedWebhookSource: {
          autoCreate: true,
          failureNoticeTitle: "Connection created, webhook setup failed",
          successNoticeTitle: "Linear connection and webhook created successfully",
        },
      },
    },
    {
      id: LinearConnectionMethodIds.OAUTH_APP,
      label: "Linear OAuth app",
      kind: "form",
      secretFields: [
        {
          name: "clientSecret",
          label: "OAuth client secret",
          placeholder: "Linear OAuth app client secret",
          inputType: "password",
          secretType: LinearCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
          slotKey: LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
        },
      ],
      configSchema: LinearOAuthAppConnectionConfigSchema,
      configForm: LinearOAuthAppConnectionConfigForm,
      ui: {
        create: {
          submitLabel: "Save Linear OAuth app",
          helperText: "Stores the Linear OAuth app client used for organization identity linking.",
        },
      },
    },
    {
      id: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      label: "Linear OAuth",
      kind: "redirect",
      configSchema: LinearOAuth2ConnectionConfigSchema,
      startConfigSchema: LinearOAuth2ConnectionStartConfigSchema,
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
          },
          required: ["client_id", "client_secret"],
        },
        uiSchema: {
          client_id: {
            "ui:placeholder": "Linear OAuth client ID",
          },
          client_secret: {
            "ui:widget": "password",
          },
        },
      }),
      ui: {
        create: {
          submitLabel: "Connect Linear",
          helperText: "Authorize Linear access with your Linear OAuth application.",
          showCallbackUrl: true,
        },
        reauthorize: {
          actionLabel: "Re-authorize",
          pendingLabel: "Starting...",
        },
      },
    },
  ],
  supportedWebhookEvents: LinearSupportedWebhookEvents,
  webhookTriggerCapabilitiesRefreshUi: {
    actionLabel: "Sync webhook events",
    pendingLabel: "Syncing...",
  },
  mcp: (input) =>
    input.binding.config.tools.includes(LinearToolIds.LINEAR_MCP)
      ? [
          {
            serverId: "linear-default",
            serverName: "linear",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: "https://mcp.linear.app/mcp",
            description: "Linear MCP",
          },
        ]
      : [],
  compileBinding: compileLinearBinding,
};
