export function resolveConnectionAuthScheme(
  config: Record<string, unknown> | null,
): "api-key" | "oauth" | null {
  if (config === null) {
    return null;
  }

  const authScheme = config["auth_scheme"];
  if (authScheme === "api-key") {
    return "api-key";
  }
  if (authScheme === "oauth") {
    return "oauth";
  }
  return null;
}

export function formatConnectionAuthMethodLabel(authScheme: "api-key" | "oauth"): string {
  if (authScheme === "api-key") {
    return "API key";
  }
  return "OAuth";
}
