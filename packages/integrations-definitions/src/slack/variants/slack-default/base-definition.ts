import {
  IntegrationFormConnectionMethodCreateBehaviors,
  IntegrationKinds,
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
import { compileSlackBinding } from "./compile-binding.js";
import { SlackConnectionConfigForm } from "./connection-config-form.js";
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
        routeSegment: "slack-app",
        instructions: {
          title: "Choose a setup method",
          description:
            "Create a new Slack app with a manifest or connect an app you've already configured in Slack.",
          manifest: {
            title: "Slack app manifest",
            description:
              "Create a Slack app from a basic manifest. You can still change the settings later in Slack.",
            createErrorMessage: "Could not create Slack app manifest.",
            startAction: {
              expectedResultKind: "redirect",
              manifestBodyField: "manifest",
              unexpectedResultMessage: "Slack app manifest setup did not return a redirect URL.",
            },
          },
          existingApp: {
            title: "Existing Slack App",
            description:
              "Paste values from a Slack app you already created or configured in Slack.",
            connectLabel: "Connect Slack to Mistle",
            installedDetection: {
              configFields: ["clientId"],
              secretFields: ["botToken", "signingSecret"],
            },
            saveErrorMessage: "Could not save Slack app setup.",
            configFields: [
              {
                configKey: "client_id",
                name: "clientId",
                label: "Client ID",
                required: false,
              },
            ],
            secretFields: [
              {
                inputType: "password",
                name: "botToken",
                label: "Bot token",
                placeholder: "xoxb-...",
                required: true,
                secretLabel: "bot token",
              },
              {
                inputType: "password",
                name: "signingSecret",
                label: "Signing secret",
                required: true,
                secretLabel: "signing secret",
              },
              {
                inputType: "password",
                name: "clientSecret",
                label: "Client secret",
                required: false,
                secretLabel: "client secret",
              },
            ],
          },
          urls: {
            title: "Slack app URLs",
            description:
              "Copy this URL into Slack Event Subscriptions, then return here to connect Slack to Mistle.",
            webhookCallback: {
              label: "Events API Request URL",
              errorTitle: "Could not load Events API Request URL",
              missingTitle: "Events API Request URL is not available yet",
              missingMessage:
                "Slack setup requires an Events API Request URL, but this connection does not have one yet.",
            },
          },
        },
        startForm: {
          submitLabel: "Create and connect Slack app",
          fields: [
            {
              name: "appConfigToken",
              label: "App configuration token",
              inputType: "password",
              required: true,
              placeholder: "xoxe.xoxp-...",
              description:
                "Generate a Slack app configuration token, then paste it here. Slack configuration tokens expire after 12 hours.",
              actions: [
                {
                  label: "Generate token in Slack",
                  href: "https://api.slack.com/apps",
                  opensInNewWindow: true,
                },
              ],
            },
          ],
        },
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
  compileBinding: compileSlackBinding,
};
