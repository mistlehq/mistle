import { describe, expect, it } from "vitest";

import {
  buildSlackAppManifestCreateUrl,
  buildSlackAppManifestExportUrl,
  buildSlackAppManifest,
  buildSlackAppManifestDraft,
  buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata,
  buildSlackOAuthAccessConnectionSecrets,
  buildSlackOAuthAccessUrl,
  buildSlackManifestConnectionConfig,
  buildSlackManifestConnectionSecrets,
  parseSlackManifestCreateErrorResponse,
  parseSlackManifestCreateSuccessResponse,
  parseSlackManifestExportErrorResponse,
  parseSlackManifestExportSuccessResponse,
  parseSlackOAuthAccessErrorResponse,
  parseSlackOAuthAccessSuccessResponse,
} from "./app-manifest.js";
import { SlackAppManifestTemplate } from "./manifest.js";

describe("SlackAppManifestTemplate", () => {
  it("includes the default Slack app permissions and event subscriptions", () => {
    expect(SlackAppManifestTemplate).toMatchObject({
      features: {
        assistant_view: {
          assistant_description:
            "Ask Mistle to help with workspace operations and follow along in Slack threads.",
        },
        bot_user: {
          display_name: "mistle",
          always_online: true,
        },
      },
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
        interactivity: {
          is_enabled: true,
          request_url: "https://mistle.example.com/api/integrations/slack/webhook",
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
            "files:read",
            "files:write",
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
          redirect_urls: SlackAppManifestTemplate.oauth_config.redirect_urls,
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
        interactivity: {
          is_enabled: true,
          request_url:
            "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
        },
      },
      oauth_config: {
        redirect_urls: expect.arrayContaining([
          "https://control-plane.example.com/p/integration/callbacks/setup/slack-app-installation",
          "https://control-plane.example.com/p/identity-linking/callbacks/slack",
        ]),
        scopes: {
          bot: expect.arrayContaining([
            "chat:write",
            "channels:history",
            "files:read",
            "files:write",
            "groups:history",
            "reactions:read",
          ]),
        },
      },
    });
    expect(manifest).not.toMatchObject({
      oauth_config: {
        redirect_urls: expect.arrayContaining(SlackAppManifestTemplate.oauth_config.redirect_urls),
      },
    });
  });

  it("replaces generated Mistle redirect URLs while preserving custom redirect URLs", () => {
    const manifest = buildSlackAppManifest({
      controlPlaneBaseUrl: "https://public-control-plane.example.com",
      webhookCallbackUrl:
        "https://public-control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
      manifest: {
        oauth_config: {
          redirect_urls: [
            "http://localhost:3000/p/integration/callbacks/setup/slack-app-installation",
            "https://private-dashboard.example.com/p/identity-linking/callbacks/slack",
            "https://customer.example.com/slack/oauth/callback",
          ],
        },
      },
    });

    expect(manifest).toMatchObject({
      oauth_config: {
        redirect_urls: [
          "https://customer.example.com/slack/oauth/callback",
          "https://public-control-plane.example.com/p/integration/callbacks/setup/slack-app-installation",
          "https://public-control-plane.example.com/p/identity-linking/callbacks/slack",
        ],
      },
    });
  });
});

describe("buildSlackAppManifestDraft", () => {
  it("builds the default Slack app manifest with real Mistle callback URLs", () => {
    const manifest = buildSlackAppManifestDraft({
      controlPlaneBaseUrl: "https://control-plane.example.com",
      webhookCallbackUrl:
        "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
    });

    expect(manifest).toMatchObject({
      features: {
        assistant_view: {
          assistant_description:
            "Ask Mistle to help with workspace operations and follow along in Slack threads.",
        },
        bot_user: {
          always_online: true,
        },
      },
      settings: {
        event_subscriptions: {
          request_url:
            "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
        },
        interactivity: {
          is_enabled: true,
          request_url:
            "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
        },
      },
      oauth_config: {
        redirect_urls: expect.arrayContaining([
          "https://control-plane.example.com/p/integration/callbacks/setup/slack-app-installation",
          "https://control-plane.example.com/p/identity-linking/callbacks/slack",
        ]),
      },
    });
    expect(manifest).not.toMatchObject({
      settings: {
        event_subscriptions: {
          request_url: "https://mistle.example.com/api/integrations/slack/webhook",
        },
        interactivity: {
          request_url: "https://mistle.example.com/api/integrations/slack/webhook",
        },
      },
      oauth_config: {
        redirect_urls: expect.arrayContaining(SlackAppManifestTemplate.oauth_config.redirect_urls),
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

describe("buildSlackAppManifestExportUrl", () => {
  it("builds the Slack manifest export endpoint URL", () => {
    expect(
      buildSlackAppManifestExportUrl({
        apiBaseUrl: "https://slack.example.com/api/",
      }),
    ).toBe("https://slack.example.com/api/apps.manifest.export");
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

describe("parseSlackManifestExportSuccessResponse", () => {
  it("accepts Slack manifest export success responses", () => {
    expect(
      parseSlackManifestExportSuccessResponse({
        ok: true,
        manifest: {
          settings: {
            event_subscriptions: {
              bot_events: ["app_mention"],
            },
          },
        },
        ignored_extra_field: true,
      }),
    ).toEqual({
      ok: true,
      manifest: {
        settings: {
          event_subscriptions: {
            bot_events: ["app_mention"],
          },
        },
      },
      ignored_extra_field: true,
    });
  });
});

describe("parseSlackManifestExportErrorResponse", () => {
  it("returns Slack manifest export error responses", () => {
    expect(
      parseSlackManifestExportErrorResponse({
        ok: false,
        error: "invalid_app_id",
      }),
    ).toEqual({
      ok: false,
      error: "invalid_app_id",
    });
  });
});

describe("buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata", () => {
  it("maps exported Slack manifest bot events and bot scopes into trigger capabilities", () => {
    expect(
      buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata({
        expectedRequestUrl:
          "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
        manifest: {
          oauth_config: {
            scopes: {
              bot: ["app_mentions:read", "channels:history"],
            },
          },
          settings: {
            event_subscriptions: {
              request_url:
                "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_123",
              bot_events: ["app_mention", "message.channels"],
            },
          },
        },
      }),
    ).toEqual({
      webhookTriggerCapabilities: {
        events: ["app_mention", "message.channels"],
        permissions: [
          {
            permission: "app_mentions:read",
          },
          {
            permission: "channels:history",
          },
        ],
      },
    });
  });

  it("rejects exported Slack manifests that point at a different Events API Request URL", () => {
    expect(() =>
      buildSlackManifestWebhookTriggerCapabilitiesProviderMetadata({
        expectedRequestUrl:
          "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_expected",
        manifest: {
          oauth_config: {
            scopes: {
              bot: ["app_mentions:read"],
            },
          },
          settings: {
            event_subscriptions: {
              request_url:
                "https://control-plane.example.com/p/integration/webhooks/slack-default/eps_other",
              bot_events: ["app_mention"],
            },
          },
        },
      }),
    ).toThrow(
      "Slack Events API Request URL must be 'https://control-plane.example.com/p/integration/webhooks/slack-default/eps_expected' before webhook events can be synced. Current Slack Request URL is 'https://control-plane.example.com/p/integration/webhooks/slack-default/eps_other'.",
    );
  });
});

describe("parseSlackOAuthAccessSuccessResponse", () => {
  it("accepts Slack OAuth access success responses", () => {
    expect(
      parseSlackOAuthAccessSuccessResponse({
        ok: true,
        access_token: "xoxb-slack-bot-token",
        token_type: "bot",
        app_id: "A123",
        bot_user_id: "U123",
        team: {
          id: "T123",
          name: "Mistle",
        },
        ignored_extra_field: true,
      }),
    ).toEqual({
      ok: true,
      access_token: "xoxb-slack-bot-token",
      token_type: "bot",
      app_id: "A123",
      bot_user_id: "U123",
      team: {
        id: "T123",
        name: "Mistle",
      },
      ignored_extra_field: true,
    });
  });

  it("rejects Slack OAuth access responses without bot token material", () => {
    expect(() =>
      parseSlackOAuthAccessSuccessResponse({
        ok: true,
        app_id: "A123",
      }),
    ).toThrow("Invalid input");
  });
});

describe("parseSlackOAuthAccessErrorResponse", () => {
  it("returns Slack OAuth access error responses", () => {
    expect(
      parseSlackOAuthAccessErrorResponse({
        ok: false,
        error: "invalid_code",
      }),
    ).toEqual({
      ok: false,
      error: "invalid_code",
    });
  });

  it("returns null for non-error responses", () => {
    expect(
      parseSlackOAuthAccessErrorResponse({
        ok: true,
        access_token: "xoxb-slack-bot-token",
      }),
    ).toBeNull();
  });
});

describe("parseSlackManifestCreateSuccessResponse", () => {
  it("accepts Slack manifest create success responses", () => {
    expect(
      parseSlackManifestCreateSuccessResponse({
        ok: true,
        app_id: "A123",
        credentials: {
          client_id: "123.456",
          client_secret: "slack-client-secret",
          signing_secret: "slack-signing-secret",
          ignored_extra_field: true,
        },
        oauth_authorize_url: "https://slack.com/oauth/v2/authorize?client_id=123.456",
        ignored_extra_field: true,
      }),
    ).toEqual({
      ok: true,
      app_id: "A123",
      credentials: {
        client_id: "123.456",
        client_secret: "slack-client-secret",
        signing_secret: "slack-signing-secret",
        ignored_extra_field: true,
      },
      oauth_authorize_url: "https://slack.com/oauth/v2/authorize?client_id=123.456",
      ignored_extra_field: true,
    });
  });

  it("rejects Slack manifest create responses without credential material", () => {
    expect(() =>
      parseSlackManifestCreateSuccessResponse({
        ok: true,
        app_id: "A123",
        credentials: {
          client_id: "123.456",
        },
        oauth_authorize_url: "https://slack.com/oauth/v2/authorize?client_id=123.456",
      }),
    ).toThrow("Invalid input");
  });
});

describe("parseSlackManifestCreateErrorResponse", () => {
  it("returns Slack manifest create error responses", () => {
    expect(
      parseSlackManifestCreateErrorResponse({
        ok: false,
        error: "invalid_manifest",
        errors: [
          {
            message: "required field is missing",
            pointer: "/settings/event_subscriptions/request_url",
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error: "invalid_manifest",
      errors: [
        {
          message: "required field is missing",
          pointer: "/settings/event_subscriptions/request_url",
        },
      ],
    });
  });

  it("returns null for non-error responses", () => {
    expect(
      parseSlackManifestCreateErrorResponse({
        ok: true,
        app_id: "A123",
      }),
    ).toBeNull();
  });
});

describe("buildSlackOAuthAccessConnectionSecrets", () => {
  it("maps Slack OAuth access tokens into connection secrets", () => {
    expect(
      buildSlackOAuthAccessConnectionSecrets({
        accessToken: "xoxb-slack-bot-token",
      }),
    ).toEqual({
      botToken: "xoxb-slack-bot-token",
    });
  });
});

describe("buildSlackManifestConnectionConfig", () => {
  it("maps Slack manifest credentials into connection config", () => {
    expect(
      buildSlackManifestConnectionConfig({
        appId: "A123",
        clientId: "123.456",
      }),
    ).toEqual({
      connection_method: "slack-bot-token",
      app_id: "A123",
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
