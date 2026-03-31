import type { BetterAuthOptions } from "better-auth";

import type { GoogleProviderConfig } from "./types.js";

export function createGoogleSocialProvider(
  config: GoogleProviderConfig,
): NonNullable<BetterAuthOptions["socialProviders"]> {
  return {
    google: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
  };
}
