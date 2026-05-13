const PUBLIC_INTEGRATION_LOGOS_BASE_PATH = "/integration-logos";

export function resolveIntegrationLogoPath(input: { logoKey: string }): string {
  const logoKey = normalizeIntegrationLogoKey(input.logoKey);
  return `${PUBLIC_INTEGRATION_LOGOS_BASE_PATH}/${logoKey}.svg`;
}

function normalizeIntegrationLogoKey(logoKeyInput: string): string {
  const logoKey = logoKeyInput.trim();

  if (logoKey.length === 0) {
    throw new Error("Integration logo key must be a non-empty string.");
  }

  return logoKey;
}
