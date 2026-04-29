export const SlackAppManifestBotScopes = [
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
] satisfies readonly string[];

export const SlackAppManifestBotEvents = [
  "app_mention",
  "message.channels",
  "message.groups",
  "reaction_added",
  "reaction_removed",
] satisfies readonly string[];

export const SlackAppManifestTemplate = {
  display_information: {
    name: "Mistle",
    description: "Connect Slack events and messages to Mistle automations.",
    background_color: "#2f855a",
  },
  features: {
    bot_user: {
      display_name: "mistle",
      always_online: false,
    },
  },
  settings: {
    event_subscriptions: {
      request_url: "https://mistle.example.com/api/integrations/slack/webhook",
      bot_events: SlackAppManifestBotEvents,
    },
    socket_mode_enabled: false,
    token_rotation_enabled: false,
  },
  oauth_config: {
    redirect_urls: [
      "https://mistle.example.com/api/integrations/slack/install/callback",
      "https://mistle.example.com/api/identity-linking/slack/callback",
    ],
    scopes: {
      bot: SlackAppManifestBotScopes,
    },
  },
} satisfies Record<string, unknown>;
