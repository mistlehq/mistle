export function resolveConnectionMethodId(
  config: Record<string, unknown> | null,
): "api-key" | "oauth2-authorization-code" | "github-app-installation" | null {
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
  return null;
}

export function formatConnectionMethodLabel(
  connectionMethod: "api-key" | "oauth2-authorization-code" | "github-app-installation",
): string {
  if (connectionMethod === "api-key") {
    return "API key";
  }
  if (connectionMethod === "oauth2-authorization-code") {
    return "OAuth 2.0 (Authorization Code)";
  }
  return "GitHub App installation";
}
