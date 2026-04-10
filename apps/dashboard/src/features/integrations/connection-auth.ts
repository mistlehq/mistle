export function resolveConnectionMethodId(
  config: Record<string, unknown> | null,
):
  | "api-key"
  | "oauth2-authorization-code"
  | "github-app-installation"
  | "slack-bot-token"
  | "chatgpt-device-code"
  | "aws-assume-role"
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
  if (connectionMethod === "aws-assume-role") {
    return "aws-assume-role";
  }
  return null;
}

export function formatConnectionMethodLabel(
  connectionMethod:
    | "api-key"
    | "oauth2-authorization-code"
    | "github-app-installation"
    | "slack-bot-token"
    | "chatgpt-device-code"
    | "aws-assume-role",
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
  if (connectionMethod === "aws-assume-role") {
    return "Access key + AssumeRole";
  }
  return "GitHub App installation";
}
