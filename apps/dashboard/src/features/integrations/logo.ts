const PUBLIC_INTEGRATION_LOGOS_BASE_PATH = "/integration-logos";

export function resolveIntegrationLogoPath(input: { logoKey: string }): string {
  const logoKey = input.logoKey.trim();

  if (logoKey.length === 0) {
    throw new Error("Integration logo key must be a non-empty string.");
  }

  return `${PUBLIC_INTEGRATION_LOGOS_BASE_PATH}/${logoKey}.svg`;
}
