const PUBLIC_INTEGRATION_LOGOS_BASE_PATH = "/integration-logos";

const DARK_MODE_LOGO_KEYS = new Set([
  "anthropic",
  "e2b",
  "github",
  "openai",
  "opencode",
  "planetscale",
]);

export function resolveIntegrationLogoPath(input: { logoKey: string }): string {
  const logoKey = normalizeIntegrationLogoKey(input.logoKey);
  return `${PUBLIC_INTEGRATION_LOGOS_BASE_PATH}/${logoKey}.svg`;
}

export function resolveDarkIntegrationLogoPath(input: { logoKey: string }): string | undefined {
  const logoKey = normalizeIntegrationLogoKey(input.logoKey);
  return DARK_MODE_LOGO_KEYS.has(logoKey)
    ? `${PUBLIC_INTEGRATION_LOGOS_BASE_PATH}/${logoKey}-dark.svg`
    : undefined;
}

function normalizeIntegrationLogoKey(logoKeyInput: string): string {
  const logoKey = logoKeyInput.trim();

  if (logoKey.length === 0) {
    throw new Error("Integration logo key must be a non-empty string.");
  }

  return logoKey;
}
