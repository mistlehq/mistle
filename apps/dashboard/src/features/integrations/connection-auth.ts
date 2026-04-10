export function resolveConnectionMethodId(
  config: Record<string, unknown> | null,
):
  | "api-key"
  | "oauth2-authorization-code"
  | "github-app-installation"
  | "slack-bot-token"
  | "chatgpt-device-code"
  | null {
  if (config === null) {
    return null;
  }

  const connectionMethod = config["connection_method"];
  if (connectionMethod === "api-key") {
    return "api-key";
  }
  if (connectionMethod === "oauth2-authorization-code") {
    return "oauth2-authorization-code";
  }
  if (connectionMethod === "github-app-installation") {
    return "github-app-installation";
  }
  if (connectionMethod === "slack-bot-token") {
    return "slack-bot-token";
  }
  if (connectionMethod === "chatgpt-device-code") {
    return "chatgpt-device-code";
  }
  return null;
}

export function formatConnectionMethodLabel(
  connectionMethod:
    | "api-key"
    | "oauth2-authorization-code"
    | "github-app-installation"
    | "slack-bot-token"
    | "chatgpt-device-code",
): string {
  if (connectionMethod === "api-key") {
    return "API key";
  }
  if (connectionMethod === "oauth2-authorization-code") {
    return "OAuth 2.0 (Authorization Code)";
  }
  if (connectionMethod === "slack-bot-token") {
    return "Bot token";
  }
  if (connectionMethod === "chatgpt-device-code") {
    return "ChatGPT subscription";
  }
  return "GitHub App installation";
}
