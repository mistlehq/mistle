const PUBLIC_INTEGRATION_LOGOS_BASE_PATH = "/integration-logos";

const IntegrationLogoDarkVariantKeys = {
  anthropic: true,
  e2b: true,
  github: true,
  openai: true,
  opencode: true,
  planetscale: true,
} satisfies Record<string, true>;

type IntegrationLogoColorScheme = "light" | "dark";

export type IntegrationLogoPaths = {
  light: string;
  dark: string | null;
};

export function resolveIntegrationLogoPath(input: {
  logoKey: string;
  colorScheme?: IntegrationLogoColorScheme;
}): string {
  const logoKey = normalizeIntegrationLogoKey(input.logoKey);
  const usesDarkVariant =
    input.colorScheme === "dark" && hasIntegrationLogoDarkVariant({ logoKey });
  const suffix = usesDarkVariant ? "-dark" : "";
  return `${PUBLIC_INTEGRATION_LOGOS_BASE_PATH}/${logoKey}${suffix}.svg`;
}

export function resolveIntegrationLogoPaths(input: { logoKey: string }): IntegrationLogoPaths {
  const logoKey = normalizeIntegrationLogoKey(input.logoKey);
  return {
    light: resolveIntegrationLogoPath({ logoKey, colorScheme: "light" }),
    dark: hasIntegrationLogoDarkVariant({ logoKey })
      ? resolveIntegrationLogoPath({ logoKey, colorScheme: "dark" })
      : null,
  };
}

export function hasIntegrationLogoDarkVariant(input: { logoKey: string }): boolean {
  const logoKey = normalizeIntegrationLogoKey(input.logoKey);
  return Object.prototype.hasOwnProperty.call(IntegrationLogoDarkVariantKeys, logoKey);
}

function normalizeIntegrationLogoKey(logoKeyInput: string): string {
  const logoKey = logoKeyInput.trim();

  if (logoKey.length === 0) {
    throw new Error("Integration logo key must be a non-empty string.");
  }

  return logoKey;
}
