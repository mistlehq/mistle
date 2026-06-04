import {
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationKinds,
  IntegrationMcpTransports,
  type IntegrationDefinition,
} from "@mistle/integrations-core";

import { buildSlackAppManifestDraft } from "./app-manifest.js";
import {
  type SlackConnectionConfig,
  SlackConnectionConfigSchema,
  SlackConnectionMethodId,
  SlackCredentialSecretTypes,
  SlackCredentialSlotKeys,
} from "./auth.js";
import { resolveSlackBindingConfigForm } from "./binding-config-form.js";
import { SlackBindingConfigSchema } from "./binding-config-schema.js";
import { compileSlackBinding, SlackMcpUrl } from "./compile-binding.js";
import { SlackConnectionConfigForm } from "./connection-config-form.js";
import {
  SlackProviderAppSetup,
  SlackProviderAppSetupPane,
  SlackProviderAppSetupRouteSegment,
  SlackProviderAppSetupStartForm,
} from "./provider-app-setup-metadata.js";
import { SlackSupportedWebhookEvents } from "./supported-webhook-events.js";
import { SlackTargetConfigSchema } from "./target-config-schema.js";
import { SlackTargetSecretSchema } from "./target-secret-schema.js";
import { SlackToolIds } from "./tool-ids.js";

export type SlackBaseIntegrationDefinition = IntegrationDefinition<
  typeof SlackTargetConfigSchema,
  typeof SlackTargetSecretSchema,
  typeof SlackBindingConfigSchema,
  SlackConnectionConfig
>;

export const SlackBaseDefinition: SlackBaseIntegrationDefinition = {
  familyId: "slack",
  variantId: "slack-default",
  kind: IntegrationKinds.CONNECTOR,
  displayName: "Slack",
  description: "Enable access to Slack Web API endpoints and Slack Events API callbacks.",
  logoKey: "slack",
  targetConfigSchema: SlackTargetConfigSchema,
  targetSecretSchema: SlackTargetSecretSchema,
  bindingConfigSchema: SlackBindingConfigSchema,
  bindingConfigForm: resolveSlackBindingConfigForm,
  identityLinking: {
    eligibleConnectionMethodIds: [SlackConnectionMethodId],
  },
  connectionMethods: [
    {
      id: SlackConnectionMethodId,
      label: "Slack app",
      kind: "form",
      createBehavior: IntegrationFormConnectionMethodCreateBehaviors.DRAFT_THEN_SETUP,
      setupFlow: {
        appManifestDraft: {
          build: buildSlackAppManifestDraft,
        },
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "botToken",
            },
            {
              kind: "secret-field",
              field: "signingSecret",
            },
          ],
        },
        providerAppSetup: SlackProviderAppSetup,
        routeSegment: SlackProviderAppSetupRouteSegment,
        setupPane: SlackProviderAppSetupPane,
        startForm: SlackProviderAppSetupStartForm,
      },
      secretFields: [
        {
          name: "botToken",
          label: "Bot token",
          placeholder: "xoxb-...",
          description: "Bot user OAuth token from your Slack app installation.",
          inputType: "password",
          secretType: SlackCredentialSecretTypes.API_KEY,
          slotKey: SlackCredentialSlotKeys.BOT_TOKEN,
        },
        {
          name: "signingSecret",
          label: "Signing secret",
          placeholder: "Slack signing secret",
          description: "Signing secret from your Slack app's Basic Information page.",
          inputType: "password",
          secretType: SlackCredentialSecretTypes.API_KEY,
          slotKey: SlackCredentialSlotKeys.SIGNING_SECRET,
        },
        {
          name: "clientSecret",
          label: "Client secret (Linked User Auth)",
          placeholder: "Slack app client secret",
          description:
            "Required only for Identity Linking / linked user authorization. Not required for standard Slack app bot-token usage.",
          inputType: "password",
          secretType: SlackCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
          slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
          optional: true,
        },
      ],
      configSchema: SlackConnectionConfigSchema,
      configForm: SlackConnectionConfigForm,
    },
  ],
  supportedWebhookEvents: SlackSupportedWebhookEvents,
  webhookTriggerCapabilitiesRefreshUi: {
    actionLabel: "Sync webhook events",
    pendingLabel: "Syncing...",
    disabledWhen: {
      missingConnectionConfigField: "app_id",
      message: "Add the Slack App ID before syncing webhook events.",
    },
    bodyForm: {
      title: "Sync webhook events",
      submitLabel: "Sync",
      fields: [
        {
          name: "appConfigToken",
          label: "App configuration token",
          inputType: "password",
          required: true,
          placeholder: "xoxe.xoxp-...",
          description: "Generate a temporary app configuration token and paste it below",
          actions: [
            {
              label: "https://api.slack.com/apps",
              href: "https://api.slack.com/apps",
              opensInNewWindow: true,
            },
          ],
        },
      ],
    },
  },
  mcp: (input) =>
    input.binding.config.tools.includes(SlackToolIds.SLACK_MCP)
      ? [
          {
            serverId: SlackToolIds.SLACK_MCP,
            serverName: "slack",
            transport: IntegrationMcpTransports.STREAMABLE_HTTP,
            url: SlackMcpUrl,
            description: "Slack MCP",
          },
        ]
      : [],
  compileBinding: compileSlackBinding,
};
