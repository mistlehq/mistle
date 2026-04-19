import { IntegrationKinds, type IntegrationDefinition } from "@mistle/integrations-core";

import {
  SlackAppOAuthConnectionConfigSchema,
  type SlackConnectionConfig,
  SlackBotTokenConnectionConfigSchema,
  SlackConnectionMethodIds,
  SlackCredentialSecretTypes,
  SlackCredentialSlotKeys,
} from "./auth.js";
import { resolveSlackBindingConfigForm } from "./binding-config-form.js";
import { SlackBindingConfigSchema } from "./binding-config-schema.js";
import { compileSlackBinding } from "./compile-binding.js";
import {
  SlackAppOAuthConnectionConfigForm,
  SlackBotTokenConnectionConfigForm,
} from "./connection-config-form.js";
import { SlackSupportedWebhookEvents } from "./supported-webhook-events.js";
import { SlackTargetConfigSchema } from "./target-config-schema.js";
import { SlackTargetSecretSchema } from "./target-secret-schema.js";

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
    eligibleConnectionMethodIds: [SlackConnectionMethodIds.SLACK_APP_OAUTH],
  },
  connectionMethods: [
    {
      id: SlackConnectionMethodIds.SLACK_BOT_TOKEN,
      label: "Bot token",
      kind: "form",
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
      ],
      configSchema: SlackBotTokenConnectionConfigSchema,
      configForm: SlackBotTokenConnectionConfigForm,
    },
    {
      id: SlackConnectionMethodIds.SLACK_APP_OAUTH,
      label: "Slack app OAuth",
      kind: "form",
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
            "Required only for Identity Linking / linked user authorization. Not required for bot-token-only Slack usage.",
          inputType: "password",
          secretType: SlackCredentialSecretTypes.OAUTH2_CLIENT_SECRET,
          slotKey: SlackCredentialSlotKeys.CLIENT_SECRET,
        },
      ],
      configSchema: SlackAppOAuthConnectionConfigSchema,
      configForm: SlackAppOAuthConnectionConfigForm,
    },
  ],
  supportedWebhookEvents: SlackSupportedWebhookEvents,
  compileBinding: compileSlackBinding,
};
