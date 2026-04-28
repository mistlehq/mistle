import { describe, expect, it } from "vitest";

import {
  buildSlackAppManifestCreateUrl,
  buildSlackAppManifest,
  buildSlackOAuthAccessUrl,
  buildSlackManifestConnectionConfig,
  buildSlackManifestConnectionSecrets,
} from "./app-manifest.js";
import { SlackAppManifestTemplate } from "./manifest.js";

describe("SlackAppManifestTemplate", () => {
  it("includes the default Slack app permissions and event subscriptions", () => {
    expect(SlackAppManifestTemplate).toMatchObject({
      settings: {
        event_subscriptions: {
          request_url: "https://mistle.example.com/api/integrations/slack/webhook",
          bot_events: [
            "app_mention",
            "message.channels",
            "message.groups",
            "reaction_added",
            "reaction_removed",
          ],
        },
      },
      oauth_config: {
        redirect_urls: [
          "https://mistle.example.com/api/integrations/slack/install/callback",
          "https://mistle.example.com/api/identity-linking/slack/callback",
        ],
        scopes: {
          bot: [
            "app_mentions:read",
            "channels:history",
            "channels:read",
            "chat:write",
            "groups:history",
            "groups:read",
            "reactions:read",
            "users:read",
          ],
        },
      },
    });
  });
});

describe("buildSlackAppManifest", () => {
  it("injects Mistle Slack request URLs, bot events, and OAuth scopes", () => {
    const manifest = buildSlackAppManifest({
      controlPlaneBaseUrl: "https://control-plane.example.com",
      webhookCallbackUrl:
        "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
      manifest: {
        display_information: {
          name: "Mistle",
        },
        settings: {
          event_subscriptions: {
            bot_events: ["app_mention"],
          },
        },
        oauth_config: {
          scopes: {
            bot: ["chat:write"],
          },
        },
      },
    });

    expect(manifest).toMatchObject({
      settings: {
        socket_mode_enabled: false,
        event_subscriptions: {
          request_url:
            "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
          bot_events: [
            "app_mention",
            "message.channels",
            "message.groups",
            "reaction_added",
            "reaction_removed",
          ],
        },
      },
      oauth_config: {
        redirect_urls: expect.arrayContaining([
          "https://control-plane.example.com/p/integration/callbacks/slack-app-installation",
          "https://control-plane.example.com/p/identity-linking/callbacks/slack",
        ]),
        scopes: {
          bot: expect.arrayContaining([
            "chat:write",
            "channels:history",
            "groups:history",
            "reactions:read",
          ]),
        },
      },
    });
  });
});

describe("buildSlackAppManifestCreateUrl", () => {
  it("builds the Slack manifest create endpoint URL", () => {
    expect(
      buildSlackAppManifestCreateUrl({
        apiBaseUrl: "https://slack.example.com/api/",
      }),
    ).toBe("https://slack.example.com/api/apps.manifest.create");
  });
});

describe("buildSlackOAuthAccessUrl", () => {
  it("builds the Slack OAuth access endpoint URL", () => {
    expect(
      buildSlackOAuthAccessUrl({
        apiBaseUrl: "https://slack.example.com/api/",
      }),
    ).toBe("https://slack.example.com/api/oauth.v2.access");
  });
});

describe("buildSlackManifestConnectionConfig", () => {
  it("maps Slack manifest credentials into connection config", () => {
    expect(
      buildSlackManifestConnectionConfig({
        clientId: "123.456",
      }),
    ).toEqual({
      connection_method: "slack-bot-token",
      client_id: "123.456",
    });
  });
});

describe("buildSlackManifestConnectionSecrets", () => {
  it("maps Slack manifest credentials into connection secrets", () => {
    expect(
      buildSlackManifestConnectionSecrets({
        clientSecret: "slack-client-secret",
        signingSecret: "slack-signing-secret",
      }),
    ).toEqual({
      clientSecret: "slack-client-secret",
      signingSecret: "slack-signing-secret",
    });
  });
});
