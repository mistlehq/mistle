export const SlackAppManifestBotScopes = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "reactions:read",
  "users:read",
] as const;

export const SlackAppManifestBotEvents = [
  "app_mention",
  "message.channels",
  "message.groups",
  "reaction_added",
  "reaction_removed",
] as const;
