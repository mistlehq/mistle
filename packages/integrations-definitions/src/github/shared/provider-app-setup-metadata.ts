import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import type {
  IntegrationFormConnectionMethodProviderAppSetup,
  IntegrationFormConnectionMethodProviderAppSetupExistingAppSecretField,
  IntegrationFormConnectionMethodSetupPaneMetadata,
  IntegrationFormConnectionMethodSetupStartForm,
} from "@mistle/integrations-core";

import {
  GitHubAppInstallationCallbackRouteKey,
  GitHubAppInstallationSetupPath,
} from "./provider-app-setup-routes.js";

type GitHubProviderAppSetupMetadataOptions = {
  supportsClientSecret: boolean;
};

export function createGitHubProviderAppSetupMetadata(
  options: GitHubProviderAppSetupMetadataOptions,
): IntegrationFormConnectionMethodProviderAppSetup {
  const secretFields: IntegrationFormConnectionMethodProviderAppSetupExistingAppSecretField[] = [
    {
      inputType: "textarea",
      name: "appPrivateKeyPem",
      label: "App private key",
      placeholder: "-----BEGIN PRIVATE KEY-----",
      required: true,
      rows: 8,
      secretLabel: "app private key",
    },
    ...(options.supportsClientSecret
      ? [
          {
            inputType: "password",
            name: "clientSecret",
            label: "Client secret",
            required: true,
            secretLabel: "client secret",
          } satisfies IntegrationFormConnectionMethodProviderAppSetupExistingAppSecretField,
        ]
      : []),
    {
      inputType: "password",
      name: "webhookSecret",
      label: "Webhook secret",
      required: true,
      secretLabel: "webhook secret",
    },
  ];

  return {
    title: "Choose a setup method",
    description:
      "Create a new GitHub App with a manifest or connect an app you've already configured in GitHub.",
    manifest: {
      title: "GitHub App Manifest",
      description:
        "Create a GitHub App from a basic manifest. You can still change the settings later in GitHub.",
      createErrorMessage: "Could not create GitHub App manifest.",
      startAction: {
        expectedResultKind: "form-post",
        manifestBodyField: "manifest",
        unexpectedResultMessage: "GitHub App manifest setup did not return a form submission.",
      },
    },
    existingApp: {
      title: "Existing GitHub App",
      description: "Paste values from a GitHub App you already created or configured in GitHub.",
      connectLabel: "Install GitHub App",
      installedDetection: {
        configFields: ["appId", "appSlug", "clientId"],
        secretFields: options.supportsClientSecret
          ? ["appPrivateKeyPem", "clientSecret", "webhookSecret"]
          : ["appPrivateKeyPem", "webhookSecret"],
      },
      saveErrorMessage: "Could not save GitHub App setup.",
      configFields: [
        {
          configKey: "app_id",
          name: "appId",
          label: "App ID",
          required: true,
        },
        {
          configKey: "app_slug",
          name: "appSlug",
          label: "App slug",
          required: true,
        },
        {
          configKey: "client_id",
          name: "clientId",
          label: "Client ID",
          required: true,
        },
      ],
      secretFields,
      startAction: {
        expectedResultKind: "redirect",
        routeSegment: GitHubAppInstallationCallbackRouteKey,
        startErrorMessage: "Could not start GitHub App installation.",
        unexpectedResultMessage: "GitHub App installation setup did not return a redirect URL.",
        pendingLabel: "Starting install...",
        installedLabel: "Manage installation",
        installedOpensInNewWindow: true,
        windowTitle: "Opening GitHub App installation...",
        installedDetection: {
          configFields: ["installation_id"],
          externalSubject: true,
        },
      },
    },
    urls: {
      title: "Hook URLs",
      description:
        "Copy these URLs into your GitHub App settings so Mistle can receive installation callbacks and webhook events.",
      setupCallback: {
        label: "Post-installation setup URL",
        path: GitHubAppInstallationSetupPath,
      },
      webhookCallback: {
        label: "Webhook callback URL",
        errorTitle: "Could not load webhook URL",
        missingTitle: "Webhook URL is not available yet",
        missingMessage:
          "GitHub setup requires a webhook callback URL, but this connection does not have one yet.",
      },
    },
  };
}

export const GitHubProviderAppSetupStartForm = {
  submitLabel: "Create app in GitHub",
  fields: [
    {
      name: "ownerKind",
      label: "Which account should the app be created in?",
      inputType: "radio",
      required: true,
      options: [
        {
          label: "Personal account",
          value: "personal",
        },
        {
          label: "Organization",
          value: "organization",
        },
      ],
    },
    {
      name: "organizationSlug",
      label: "GitHub organization",
      inputType: "text",
      required: true,
      placeholder: "github-org",
      visibleWhen: {
        field: "ownerKind",
        value: "organization",
      },
    },
  ],
} satisfies IntegrationFormConnectionMethodSetupStartForm;

export const GitHubProviderAppSetupPane = {
  kind: "provider-app",
} satisfies IntegrationFormConnectionMethodSetupPaneMetadata;

export const GitHubProviderAppSetupRouteSegment = "github-app";
export const GitHubProviderAppSetupMethodId =
  IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION;
