import { describe, expect, it } from "vitest";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  resolveIntegrationSetupAppManifestDraftBuilderOrThrow,
  resolveIntegrationProviderAppSetupOrThrow,
  resolveIntegrationSetupPaneOrThrow,
  resolveIntegrationSetupStartFormOrThrow,
  resolveManifestDraftControlPlaneBaseUrl,
} from "./integration-connection-setup-manifest-draft.js";

const GitHubConnection = {
  createdAt: "2026-04-28T00:00:00.000Z",
  displayName: "GitHub",
  id: "icn_github_setup",
  status: "active",
  targetKey: "github-cloud",
  connectionMethodId: "github-app-installation",
  updatedAt: "2026-04-28T00:00:00.000Z",
} satisfies IntegrationConnection;

const SlackConnection = {
  createdAt: "2026-04-28T00:00:00.000Z",
  displayName: "Slack",
  id: "icn_slack_setup",
  status: "active",
  targetKey: "slack-default",
  connectionMethodId: "slack-bot-token",
  updatedAt: "2026-04-28T00:00:00.000Z",
} satisfies IntegrationConnection;

describe("resolveManifestDraftControlPlaneBaseUrl", () => {
  it("uses the provider-facing webhook callback URL base", () => {
    expect(
      resolveManifestDraftControlPlaneBaseUrl({
        webhookCallbackUrl:
          "https://public-control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
      }),
    ).toBe("https://public-control-plane.example.com");
  });

  it("preserves provider-facing path prefixes", () => {
    expect(
      resolveManifestDraftControlPlaneBaseUrl({
        webhookCallbackUrl:
          "https://public-control-plane.example.com/base/p/integration/webhooks/slack-default/eps_123",
      }),
    ).toBe("https://public-control-plane.example.com/base");
  });

  it("fails fast when the callback URL does not use the webhook callback route", () => {
    expect(() =>
      resolveManifestDraftControlPlaneBaseUrl({
        webhookCallbackUrl: "https://public-control-plane.example.com/webhooks/slack",
      }),
    ).toThrow(
      "Webhook callback URL 'https://public-control-plane.example.com/webhooks/slack' is not a manifest webhook callback URL.",
    );
  });
});

describe("resolveIntegrationSetupAppManifestDraftBuilderOrThrow", () => {
  it("resolves the GitHub manifest draft builder from the browser definition", () => {
    const buildDraft = resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
      connection: GitHubConnection,
      setupRoute: {
        methodId: "github-app-installation",
        routeSegment: "github-app",
      },
    });

    expect(
      buildDraft({
        controlPlaneBaseUrl: "https://control-plane.example.com",
        webhookCallbackUrl: "https://control-plane.example.com/webhooks/github",
      }),
    ).toMatchObject({
      hook_attributes: {
        active: true,
        url: "https://control-plane.example.com/webhooks/github",
      },
      redirect_url:
        "https://control-plane.example.com/p/integration/callbacks/setup/github-app-manifest",
    });
  });

  it("resolves the Slack manifest draft builder from the browser definition", () => {
    const buildDraft = resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
      connection: SlackConnection,
      setupRoute: {
        methodId: "slack-bot-token",
        routeSegment: "slack-app",
      },
    });

    expect(
      buildDraft({
        controlPlaneBaseUrl: "https://control-plane.example.com",
        webhookCallbackUrl: "https://control-plane.example.com/webhooks/slack",
      }),
    ).toMatchObject({
      settings: {
        event_subscriptions: {
          request_url: "https://control-plane.example.com/webhooks/slack",
        },
      },
    });
  });

  it("fails fast when the setup flow has no manifest draft builder", () => {
    expect(() =>
      resolveIntegrationSetupAppManifestDraftBuilderOrThrow({
        connection: GitHubConnection,
        setupRoute: {
          methodId: "api-key",
          routeSegment: "github-app",
        },
      }),
    ).toThrow(
      "Integration setup flow 'api-key/github-app' is not a browser form setup flow for target 'github-cloud'.",
    );
  });
});

describe("resolveIntegrationSetupStartFormOrThrow", () => {
  it("resolves the Slack setup start form from the browser definition", () => {
    expect(
      resolveIntegrationSetupStartFormOrThrow({
        connection: SlackConnection,
        setupRoute: {
          methodId: "slack-bot-token",
          routeSegment: "slack-app",
        },
      }),
    ).toEqual({
      submitLabel: "Create and connect Slack app",
      fields: [
        {
          name: "appConfigToken",
          label: "App configuration token",
          inputType: "password",
          required: true,
          placeholder: "xoxe.xoxp-...",
          description:
            "Generate a temporary token from https://api.slack.com/apps and paste it below",
          actions: [
            {
              label: "https://api.slack.com/apps",
              href: "https://api.slack.com/apps",
              opensInNewWindow: true,
            },
          ],
        },
      ],
    });
  });

  it("resolves the GitHub setup start form from the browser definition", () => {
    expect(
      resolveIntegrationSetupStartFormOrThrow({
        connection: GitHubConnection,
        setupRoute: {
          methodId: "github-app-installation",
          routeSegment: "github-app",
        },
      }),
    ).toMatchObject({
      submitLabel: "Create app in GitHub",
      fields: [
        {
          name: "ownerKind",
          inputType: "radio",
          required: true,
        },
        {
          name: "organizationSlug",
          inputType: "text",
          required: true,
          visibleWhen: {
            field: "ownerKind",
            value: "organization",
          },
        },
      ],
    });
  });
});

describe("resolveIntegrationProviderAppSetupOrThrow", () => {
  it("resolves Slack provider app setup from the browser definition", () => {
    expect(
      resolveIntegrationProviderAppSetupOrThrow({
        connection: SlackConnection,
        setupRoute: {
          methodId: "slack-bot-token",
          routeSegment: "slack-app",
        },
      }),
    ).toMatchObject({
      title: "Choose a setup method",
      description:
        "Create a new Slack app with a manifest or connect an app you've already configured in Slack.",
      manifest: {
        title: "Slack app manifest",
        description:
          "Create a Slack app from a basic manifest. You can still change the settings later in Slack.",
      },
      existingApp: {
        title: "Existing Slack App",
        connectLabel: "Connect Slack to Mistle",
      },
      urls: {
        title: "Slack app URLs",
        webhookCallback: {
          label: "Events API Request URL",
          errorTitle: "Could not load Events API Request URL",
        },
      },
    });
  });

  it("resolves GitHub provider app setup from the browser definition", () => {
    expect(
      resolveIntegrationProviderAppSetupOrThrow({
        connection: GitHubConnection,
        setupRoute: {
          methodId: "github-app-installation",
          routeSegment: "github-app",
        },
      }),
    ).toMatchObject({
      title: "Choose a setup method",
      manifest: {
        startAction: {
          expectedResultKind: "form-post",
        },
      },
      existingApp: {
        title: "Existing GitHub App",
        connectLabel: "Install GitHub App",
        startAction: {
          routeSegment: "github-app-installation",
          installedLabel: "Manage Installation",
        },
      },
      urls: {
        title: "Hook URLs",
      },
    });
  });
});

describe("resolveIntegrationSetupPaneOrThrow", () => {
  it("resolves Slack setup pane metadata from the browser definition", () => {
    expect(
      resolveIntegrationSetupPaneOrThrow({
        connection: SlackConnection,
        setupRoute: {
          methodId: "slack-bot-token",
          routeSegment: "slack-app",
        },
      }),
    ).toEqual({
      kind: "provider-app",
    });
  });

  it("resolves GitHub setup pane metadata from the browser definition", () => {
    expect(
      resolveIntegrationSetupPaneOrThrow({
        connection: GitHubConnection,
        setupRoute: {
          methodId: "github-app-installation",
          routeSegment: "github-app",
        },
      }),
    ).toEqual({
      kind: "provider-app",
    });
  });
});
