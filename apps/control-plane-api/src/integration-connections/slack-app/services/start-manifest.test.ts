import { describe, expect, it } from "vitest";

import { buildSlackAppManifest } from "./manifest-builder.js";

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
