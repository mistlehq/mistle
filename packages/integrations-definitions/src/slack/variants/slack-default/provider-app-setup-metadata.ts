import type {
  IntegrationFormConnectionMethodProviderAppSetup,
  IntegrationFormConnectionMethodSetupPaneMetadata,
  IntegrationFormConnectionMethodSetupStartForm,
} from "@mistle/integrations-core";

import { SlackConnectionMethodId } from "./auth.js";

export const SlackProviderAppSetup = {
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
    description: "Paste values from a Slack app you already created or configured in Slack.",
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
} satisfies IntegrationFormConnectionMethodProviderAppSetup;

export const SlackProviderAppSetupStartForm = {
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
} satisfies IntegrationFormConnectionMethodSetupStartForm;

export const SlackProviderAppSetupPane = {
  kind: "provider-app",
} satisfies IntegrationFormConnectionMethodSetupPaneMetadata;

export const SlackProviderAppSetupRouteSegment = "slack-app";
export const SlackProviderAppSetupMethodId = SlackConnectionMethodId;
