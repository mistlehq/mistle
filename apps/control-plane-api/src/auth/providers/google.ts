import type { BetterAuthOptions } from "better-auth";

import type { GoogleProviderConfig } from "./types.js";

export function createGoogleSocialProvider(
  config: GoogleProviderConfig & { allowSignups: boolean },
): NonNullable<BetterAuthOptions["socialProviders"]> {
  return {
    google: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      disableImplicitSignUp: !config.allowSignups,
      ...(config.authorizationEndpoint === undefined
        ? {}
        : { authorizationEndpoint: config.authorizationEndpoint }),
      ...(config.verifyIdToken === undefined ? {} : { verifyIdToken: config.verifyIdToken }),
      ...(config.getUserInfo === undefined ? {} : { getUserInfo: config.getUserInfo }),
    },
  };
}
