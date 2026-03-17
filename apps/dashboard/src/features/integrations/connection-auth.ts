export function resolveConnectionMethodId(
  config: Record<string, unknown> | null,
): "api-key" | "oauth2" | "github-app-installation" | null {
  if (config === null) {
    return null;
  }

  const connectionMethod = config["connection_method"];
  if (connectionMethod === "api-key") {
    return "api-key";
  }
  if (connectionMethod === "oauth2") {
    return "oauth2";
  }
  if (connectionMethod === "github-app-installation") {
    return "github-app-installation";
  }
  return null;
}

export function formatConnectionMethodLabel(
  connectionMethod: "api-key" | "oauth2" | "github-app-installation",
): string {
  if (connectionMethod === "api-key") {
    return "API key";
  }
  if (connectionMethod === "oauth2") {
    return "OAuth2";
  }
  return "GitHub App installation";
}
