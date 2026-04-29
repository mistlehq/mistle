import { describe, expect, it } from "vitest";

import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  resolveIntegrationSetupAppManifestDraftBuilderOrThrow,
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
  it("uses the provider-facing webhook callback URL origin", () => {
    expect(
      resolveManifestDraftControlPlaneBaseUrl({
        webhookCallbackUrl:
          "https://public-control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
      }),
    ).toBe("https://public-control-plane.example.com");
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
